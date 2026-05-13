import express from 'express';
import bodyParser from 'body-parser';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import errorHandler from './_middleware/error-handler';
import accountsController from './accounts/accounts.controller';
import swaggerDocs from './_helpers/swagger';

const app = express();

app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());
app.use(cookieParser());

// CORS configuration: permissive in dev, locked to CORS_ORIGIN in prod
const corsOrigin = process.env.CORS_ORIGIN;
app.use(cors({
    origin: process.env.NODE_ENV === 'production'
        ? (corsOrigin ? corsOrigin.split(',').map(x => x.trim()) : false)
        : (origin, callback) => callback(null, true),
    credentials: true
}));

// API routes
app.use('/accounts', accountsController);

// Swagger docs route
app.use('/api-docs', swaggerDocs);

// Global error handler
app.use(errorHandler);

// Export app for Vercel
export default app;

// Start server if not running on Vercel
if (process.env.NODE_ENV !== 'production' || !process.env.VERCEL) {
    const port = process.env.NODE_ENV === 'production' ? (process.env.PORT || 80) : 4000;
    app.listen(port, () => console.log('Server listening on port ' + port));
}
