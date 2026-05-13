import jwt from 'express-jwt';
import fs from 'fs';
import path from 'path';
import db from '../_helpers/db';

const configPath = path.join(__dirname, '../config.json');
const fileConfig = fs.existsSync(configPath) ? require('../config.json') : {};

// Use JWT_SECRET from env or config
const secret = process.env.JWT_SECRET || fileConfig.secret;

export default function authorize(roles: any = []) {
    if (typeof roles === 'string') {
        roles = [roles];
    }

    return [
        jwt({ secret, algorithms: ['HS256'] }),
        async (req: any, res: any, next: any) => {
            const account = await db.Account.findByPk(req.user.sub);

            if (!account || (roles.length && !roles.includes(account.role))) {
                return res.status(401).json({ message: 'Unauthorized' });
            }

            req.user = account; // Attach account to request
            req.user.role = account.role;
            const refreshTokens = await account.getRefreshTokens();
            req.user.ownsToken = (token: any) => !!refreshTokens.find((x: any) => x.token === token);
            next();
        }
    ];
}
