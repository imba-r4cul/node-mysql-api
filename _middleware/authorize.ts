import jwt from 'express-jwt';
import config from '../config.json';
import db from '../_helpers/db';

const { secret } = config;

export default function authorize(roles: any = []) {
  if (typeof roles === 'string') {
    roles = [roles];
  }

  return [
    jwt({ secret, algorithms: ['HS256'] }),
    async (req: any, res: any, next: any) => {
      const account = await db.Account.findByPk(req.user.id);

      if (!account || (roles.length && !roles.includes(account.role))) {
        return res.status(401).json({ message: 'Unauthorized' });
      }

      req.user.role = account.role;
      const refreshTokens = await account.getRefreshTokens();
      req.user.ownsToken = (token: any) => !!refreshTokens.find((x: any) => x.token === token);
      next();
    }
  ];
}