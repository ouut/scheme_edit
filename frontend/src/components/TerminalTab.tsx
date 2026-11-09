import React, { useEffect, useRef, useImperativeHandle, forwardRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { GuiActionPayload } from '../types';

export interface TerminalTabProps {
  id: string;
  cmd: 'steel' | 'bash';
  isActive: boolean;
  onGuiAction: (payload: GuiActionPayload) => void;
}

export interface TerminalTabHandle {
  sendInput: (data: string) => void;
  scrollToBottom: () => void;
  fit: () => void;
  focus: () => void;
}

export const TerminalTab = forwardRef<TerminalTabHandle, TerminalTabProps>(
  ({ id, cmd, isActive, onGuiAction }, ref) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const termRef = useRef<Terminal | null>(null);
    const fitAddonRef = useRef<FitAddon | null>(null);
    const wsRef = useRef<WebSocket | null>(null);
    const pendingInputQueueRef = useRef<string[]>([]);
    const isDestroyedRef = useRef(false);

    const onGuiActionRef = useRef(onGuiAction);
    onGuiActionRef.current = onGuiAction;

    const isActiveRef = useRef(isActive);
    isActiveRef.current = isActive;

    const sendResize = (cols: number, rows: number) => {
      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN && cols > 0 && rows > 0) {
        ws.send(JSON.stringify({ type: 'resize', cols, rows }));
      }
    };

    const doFit = () => {
      if (!fitAddonRef.current || !containerRef.current) return;
      if (containerRef.current.clientWidth === 0 || containerRef.current.clientHeight === 0) return;
      try {
        fitAddonRef.current.fit();
        const term = termRef.current;
        if (term && term.cols && term.rows) {
          sendResize(term.cols, term.rows);
        }
      } catch (err) {
        // ignore dimension errors during quick split animation
      }
    };

    // Expose methods to parent
    useImperativeHandle(ref, () => ({
      sendInput: (data: string) => {
        const ws = wsRef.current;
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(data);
        } else {
          pendingInputQueueRef.current.push(data);
        }
      },
      scrollToBottom: () => {
        termRef.current?.scrollToBottom();
      },
      fit: () => {
        doFit();
      },
      focus: () => {
        termRef.current?.focus();
      },
    }));

    // Re-fit and focus when tab becomes active
    useEffect(() => {
      if (isActive) {
        const timer = setTimeout(() => {
          doFit();
          termRef.current?.focus();
        }, 50);
        return () => clearTimeout(timer);
      }
    }, [isActive]);

    // Initialize Terminal & WebSocket
    useEffect(() => {
      isDestroyedRef.current = false;
      if (!containerRef.current) return;

      const term = new Terminal({
        cursorBlink: true,
        cursorStyle: 'block',
        fontSize: 13,
        fontFamily: 'var(--font-mono, "JetBrains Mono", "Fira Code", monospace)',
        lineHeight: 1.25,
        convertEol: true,
        scrollback: 5000,
        theme: {
          background: '#1a1b26',
          foreground: '#c0caf5',
          cursor: '#7aa2f7',
          cursorAccent: '#1a1b26',
          selectionBackground: '#33467c',
          black: '#15161e',
          red: '#f7768e',
          green: '#9ece6a',
          yellow: '#e0af68',
          blue: '#7aa2f7',
          magenta: '#bb9af7',
          cyan: '#7dcfff',
          white: '#a9b1d6',
          brightBlack: '#414868',
          brightRed: '#f7768e',
          brightGreen: '#9ece6a',
          brightYellow: '#e0af68',
          brightBlue: '#7aa2f7',
          brightMagenta: '#bb9af7',
          brightCyan: '#7dcfff',
          brightWhite: '#c0caf5',
        },
      });

      const fitAddon = new FitAddon();
      term.loadAddon(fitAddon);
      term.open(containerRef.current);

      termRef.current = term;
      fitAddonRef.current = fitAddon;

      // Handle user typing
      const onDataDispose = term.onData((data) => {
        const ws = wsRef.current;
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(data);
        }
      });

      // Handle resize
      const onResizeDispose = term.onResize(({ cols, rows }) => {
        sendResize(cols, rows);
      });

      // Setup ResizeObserver on container
      const ro = new ResizeObserver(() => {
        if (isActiveRef.current) {
          doFit();
        }
      });
      ro.observe(containerRef.current);

      // Connect WebSocket
      let reconnectTimer: number | null = null;

      const connectWs = () => {
        if (isDestroyedRef.current) return;

        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const host = window.location.host;
        const wsUrl = `${protocol}//${host}/ws/terminal?tab_id=${encodeURIComponent(id)}&cmd=${encodeURIComponent(cmd)}`;

        const ws = new WebSocket(wsUrl);
        wsRef.current = ws;

        ws.onopen = () => {
          if (isDestroyedRef.current) {
            ws.close();
            return;
          }
          doFit();
          if (term.cols && term.rows) {
            sendResize(term.cols, term.rows);
          }
          // Flush pending inputs
          while (pendingInputQueueRef.current.length > 0) {
            const next = pendingInputQueueRef.current.shift()!;
            ws.send(next);
          }
        };

        ws.onmessage = (event) => {
          if (typeof event.data === 'string') {
            const trimmed = event.data.trim();

            // 1. Check if direct JSON gui_action message
            if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
              try {
                const parsed = JSON.parse(trimmed);
                if (parsed && parsed.type === 'gui_action') {
                  onGuiActionRef.current({
                    id: parsed.id,
                    action: parsed.action,
                    file: parsed.file,
                    left: parsed.left,
                    right: parsed.right,
                  });
                  return; // Don't print control frame to terminal
                }
              } catch {
                // Not valid JSON, continue to write
              }
            }

            // 2. Check if embedded gui_action in terminal stdout (e.g. from bash/CLI)
            if (trimmed.includes('"gui_action"')) {
              const match = trimmed.match(/\{[\s\S]*?"type"\s*:\s*"gui_action"[\s\S]*?\}/);
              if (match) {
                try {
                  const parsed = JSON.parse(match[0]);
                  if (parsed && parsed.type === 'gui_action') {
                    onGuiActionRef.current({
                      id: parsed.id,
                      action: parsed.action,
                      file: parsed.file,
                      left: parsed.left,
                      right: parsed.right,
                    });
                    const remainder = trimmed.replace(match[0], '').trim();
                    if (remainder) {
                      term.write(remainder + '\r\n');
                    }
                    return;
                  }
                } catch {
                  // Not valid, continue to write
                }
              }
            }

            term.write(event.data);
          } else if (event.data instanceof ArrayBuffer) {
            term.write(new Uint8Array(event.data));
          } else if (event.data instanceof Blob) {
            event.data.arrayBuffer().then((buf) => {
              term.write(new Uint8Array(buf));
            });
          }
        };

        ws.onerror = () => {
          // Silent or graceful handling
        };

        ws.onclose = () => {
          if (isDestroyedRef.current) return;
          // Auto-reconnect after 2.5s if unexpectedly disconnected
          reconnectTimer = window.setTimeout(() => {
            connectWs();
          }, 2500);
        };
      };

      connectWs();

      // Initial fit after short layout delay
      const initTimer = setTimeout(() => {
        doFit();
      }, 50);

      return () => {
        isDestroyedRef.current = true;
        clearTimeout(initTimer);
        if (reconnectTimer) clearTimeout(reconnectTimer);
        onDataDispose.dispose();
        onResizeDispose.dispose();
        ro.disconnect();

        if (wsRef.current) {
          wsRef.current.close();
          wsRef.current = null;
        }

        try {
          fitAddon.dispose();
          term.dispose();
        } catch {
          // ignore
        }
      };
    }, [id, cmd]);

    return (
      <div
        ref={containerRef}
        className="w-full h-full p-2 bg-[#1a1b26] overflow-hidden"
      />
    );
  }
);

TerminalTab.displayName = 'TerminalTab';
