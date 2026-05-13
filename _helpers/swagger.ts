import express from 'express';
const router = express.Router();
import swaggerUi from 'swagger-ui-express';
import swaggerDocument from '../swagger.json';

const options = {
    customCssUrl: 'https://cdnjs.cloudflare.com/ajax/libs/swagger-ui/4.18.3/swagger-ui.css',
    customJs: [
        'https://cdnjs.cloudflare.com/ajax/libs/swagger-ui/4.18.3/swagger-ui-bundle.js',
        'https://cdnjs.cloudflare.com/ajax/libs/swagger-ui/4.18.3/swagger-ui-standalone-preset.js'
    ]
};

router.use('/', swaggerUi.serve, swaggerUi.setup(swaggerDocument, options));

export default router;