import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';

function steelEvalPlugin() {
  return {
    name: 'steel-eval-plugin',
    configureServer(server: any) {
      server.middlewares.use(async (req: any, res: any, next: any) => {
        if (req.url === '/api/eval' && req.method === 'POST') {
          let body = '';
          req.on('data', (chunk: any) => {
            body += chunk;
          });
          req.on('end', async () => {
            try {
              const { code } = JSON.parse(body || '{}');
              const startTime = Date.now();
              const tmpFile = path.join(
                os.tmpdir(),
                `steel_${Date.now()}_${Math.random().toString(36).substring(7)}.scm`
              );
              fs.writeFileSync(tmpFile, code || '');

              const proc = spawn('/root/.cargo/bin/steel', [tmpFile]);
              let stdout = '';
              let stderr = '';

              proc.stdout.on('data', (d: any) => {
                stdout += d;
              });
              proc.stderr.on('data', (d: any) => {
                stderr += d;
              });

              proc.on('close', (codeStatus: any) => {
                try {
                  fs.unlinkSync(tmpFile);
                } catch {
                  // ignore
                }
                const duration = Date.now() - startTime;
                res.setHeader('Content-Type', 'application/json');
                res.end(
                  JSON.stringify({
                    success: codeStatus === 0,
                    result: stdout.trim(),
                    stdout: stdout,
                    stderr: stderr,
                    duration_ms: duration,
                  })
                );
              });
            } catch (e: any) {
              res.statusCode = 500;
              res.setHeader('Content-Type', 'application/json');
              res.end(
                JSON.stringify({
                  success: false,
                  error: e.message || 'Evaluation error',
                })
              );
            }
          });
          return;
        }
        next();
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), steelEvalPlugin()],
  server: {
    port: 5173,
    host: true,
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
