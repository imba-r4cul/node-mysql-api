import mysql from 'mysql2/promise';
import { Sequelize } from 'sequelize';
import accountModel from '../accounts/account.model';
import refreshTokenModel from '../accounts/refresh-token.model';
import fs from 'fs';
import path from 'path';

const configPath = path.join(__dirname, '../config.json');
const fileConfig = fs.existsSync(configPath) ? require('../config.json') : { database: {} };

const db: any = {};
export default db;

// Initialize the database
initialize();

async function initialize() {
    // Support Environment Variables for production (Render) or config.json for local
    const host = process.env.DB_HOST || fileConfig.database.host;
    const port = process.env.DB_PORT ? parseInt(process.env.DB_PORT, 10) : (fileConfig.database.port || 3306);
    const user = process.env.DB_USER || fileConfig.database.user;
    const password = process.env.DB_PASSWORD || fileConfig.database.password;
    const database = process.env.DB_NAME || fileConfig.database.database;
    const ssl = process.env.DB_SSL === 'true';

    // In local development, create the DB if it doesn't exist
    if (process.env.NODE_ENV !== 'production' && host === 'localhost') {
        const connection = await mysql.createConnection({ host, port, user, password });
        await connection.query(`CREATE DATABASE IF NOT EXISTS \`${database}\`;`);
    }

    // Connect to MySQL with Sequelize
    const sequelize = new Sequelize(database, user, password, { 
        host, 
        port, 
        dialect: 'mysql',
        dialectModule: require('mysql2'),
        dialectOptions: ssl ? { 
            ssl: { rejectUnauthorized: false },
            connectTimeout: 60000 // 60 seconds timeout
        } : {
            connectTimeout: 60000 
        },
        pool: {
            max: 5,
            min: 0,
            acquire: 60000,
            idle: 10000
        }
    });

    // Init models and attach to db object
    db.Account = accountModel(sequelize);
    db.RefreshToken = refreshTokenModel(sequelize);

    // Define relationships
    db.Account.hasMany(db.RefreshToken, { onDelete: 'CASCADE' });
    db.RefreshToken.belongsTo(db.Account);

    // Sync all models with database
    await sequelize.sync();
}