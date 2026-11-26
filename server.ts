import path from 'node:path';
import express from 'express';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
import { verifyCsrfForMutations } from './server/middleware/auth';
import { authRouter } from './server/routes/authRoutes';
import { inventoryRouter } from './server/routes/inventoryRoutes';
import { salesCashRouter } from './server/routes/salesCashRoutes';
import { adminReportsRouter } from './server/routes/adminReportsRoutes';

dotenv.config();

async function startServer() {
  const app = express();
  const port = Number(process.env.PORT_APP || 3000);
  const isProd = process.env.NODE_ENV === 'production';

  app.set('trust proxy', 1);
  app.use(cookieParser());
  app.use(express.json({ limit: '2mb' }));

  // CSRF validation for cookie-authenticated mutations
  app.use('/api', verifyCsrfForMutations);

  // API routes
  app.use('/api', authRouter);
  app.use('/api', inventoryRouter);
  app.use('/api', salesCashRouter);
  app.use('/api', adminReportsRouter);

  // Catch unmatched /api/* routes with JSON 404
  app.all('/api/*', (_req, res) => {
    res.status(404).json({ error: 'Ruta de API no encontrada.' });
  });

  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(port, '0.0.0.0', () => {
    console.log(`Botica ERP servidor ejecutándose en http://0.0.0.0:${port}`);
  });
}

startServer().catch((err) => {
  console.error('Error fatal al iniciar servidor:', err);
  process.exit(1);
});
