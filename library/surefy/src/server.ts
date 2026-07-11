import express, { Application, Router } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import morgan from 'morgan';
import hpp from 'hpp';
import swaggerUi from 'swagger-ui-express';
import * as path from 'path';
import * as fs from 'fs';
import { errorHandler } from './middleware/errorHandler';
import HealthRoute from './routes/health.route';
import db from '@surefy/console/database';

interface RouteConfig {
  basePath: string;
  route: Router;
}

const createBaseApp = async (routes: RouteConfig[] = []): Promise<Application> => {
  const app: Application = express();
  const PORT = process.env.PORT || 8000;

  // Middleware
  app.use(
    helmet({
      contentSecurityPolicy: false,
    })
  );

  app.use(cors());
  app.use(hpp());
  app.use(compression());
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));
  app.use(morgan('dev'));

  // Swagger Documentation
  try {
    const swaggerPath = path.join(__dirname, '../../../swagger.json');

    if (fs.existsSync(swaggerPath)) {
      const swaggerDocument = JSON.parse(fs.readFileSync(swaggerPath, 'utf8'));

      app.use(
        '/api-docs',
        swaggerUi.serve,
        swaggerUi.setup(swaggerDocument, {
          customCss: '.swagger-ui .topbar { display: none }',
          customSiteTitle: 'Console API Documentation',
        })
      );

      console.log('📚 Swagger UI available at /api-docs');
    }
  } catch (error) {
    console.warn('⚠️ Swagger documentation not available');
  }

  // Database Connection Check
  try {
    await db.raw('SELECT 1');

    console.log('✅ Database connected successfully');
  } catch (error) {
    console.error('❌ Unable to connect to database');
    console.error(error);

    process.exit(1);
  }

  // Health route
  app.use('/health', HealthRoute);

  // Register custom routes
  routes.forEach(({ basePath, route }) => {
    app.use(basePath, route);
  });

  // 404 handler
  app.use((req, res) => {
    res.status(404).json({
      success: false,
      error: {
        message: 'Route not found',
        path: req.path,
        method: req.method,
        code: 404,
      },
    });
  });

  // Error handler
  app.use(errorHandler);

  // Start server
  if (process.env.WORKER_MODE !== 'true') {
    app.listen(PORT, () => {
      console.log(`🚀 Server is running on port ${PORT}`);
      console.log(`📦 Environment: ${process.env.NODE_ENV || 'development'}`);
      console.log(`🔗 Health check: http://localhost:${PORT}/health`);
      console.log(`📚 API Documentation: http://localhost:${PORT}/api-docs`);
    });
  }

  return app;
};

export default createBaseApp;