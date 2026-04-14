# Building a Node.js, TypeScript & MySQL Boilerplate API

Welcome to this step-by-step tutorial! We are going to build a fully functional authentication API from scratch. By writing the code yourself, you will understand how all the pieces—TypeScript, Express, Sequelize (MySQL), and JWTs—fit together.

## What We Are Building

We will create an API that handles:

- **User Registration & Email Verification**: Users sign up and must click a link sent to their email.
- **Authentication**: Login system using short-lived JWTs and long-lived Refresh Tokens.
- **Role-Based Access Control (RBAC)**: Admin and User roles.
- **Account Management**: Forgot password, reset password, and basic CRUD operations.
- **Swagger api documentation route**

## Overview

There are no users registered in the node.js boilerplate api by default, in order to authenticate you must first register and verify an account. The api sends a verification email after registration with a token to verify the account. Email SMTP settings must be set in the config.json file for email to work correctly, you can create a free test account in one click at https://ethereal.email/ and copy the options below the title Nodemailer configuration.

The first account registered is assigned to the Admin role and subsequent accounts are assigned to the regular User role. Admins have full access to CRUD routes for managing all accounts, while regular users can only modify their own account.

---

## JWT authentication with refresh tokens

Authentication is implemented with JWT access tokens and refresh tokens. On successful authentication the boilerplate api returns a short lived JWT access token that expires after 15 minutes, and a refresh token that expires after 7 days in a HTTP Only cookie. The JWT is used for accessing secure routes on the api and the refresh token is used for generating new JWT access tokens when (or just before) they expire. HTTP Only cookies are used for increased security because they are not accessible to client-side javascript which prevents XSS (cross site scripting), and the refresh token can only be used to fetch a new JWT token from the `/accounts/refresh-token` route which prevents CSRF (cross site request forgery).

## Refresh token rotation

As an added security measure in the `refreshToken()` method of the account service, each time a refresh token is used to generate a new JWT token, the refresh token is revoked and replaced by a new refresh token. This technique is known as Refresh Token Rotation and increases security by reducing the lifetime of refresh tokens, which makes it less likely that a compromised token will be valid (or valid for long). When a refresh token is rotated the new token is saved in the `replacedByToken` property of the revoked token to create an audit trail in the MySQL database.

---

## Part 1: Project Setup

First, let's initialize a new Node.js project and install the necessary dependencies.

Open your terminal and run:

```bash
mkdir node-mysql-api
cd node-mysql-api
npm init -y
```

### Install Dependencies

We need production dependencies (Express, Sequelize, JWT, etc.) and development dependencies (TypeScript, type definitions, nodemon).

```bash
# Production dependencies
npm install express cors body-parser cookie-parser bcryptjs jsonwebtoken mysql2 sequelize nodemailer joi swagger-ui-express yamljs express-jwt

# Development dependencies
npm install -D typescript ts-node nodemon @types/node @types/express @types/cors @types/cookie-parser @types/bcryptjs @types/jsonwebtoken @types/nodemailer @types/swagger-ui-express @types/yamljs
```

### Initialize TypeScript

Create a `tsconfig.json` file to tell TypeScript how to compile our code:

```bash
npx tsc --init
```

Update your `tsconfig.json` to match these core settings:

```json
{
  "compilerOptions": {
    "target": "es2018",
    "module": "commonjs",
    "lib": ["es2018"],
    "outDir": "./dist",
    "rootDir": "./",
    "strict": false,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true
  },
  "include": ["**/*.ts"],
  "exclude": ["node_modules"]
}
```

### Update Package.json Scripts

In your `package.json`, add these scripts to run the server:

```json
"scripts": {
  "start": "ts-node ./server.ts",
  "start:dev": "nodemon --exec ts-node ./server.ts"
}
```

---

## Part 2: Configuration & Database Setup

Create a `config.json` file in the root directory. This holds our database credentials, JWT secret, and email settings.

```json
{
  "database": {
    "host": "localhost",
    "port": 3306,
    "user": "root",
    "password": "your_mysql_password",
    "database": "node_mysql_api"
  },
  "secret": "SUPER_SECRET_KEY_REPLACE_ME_IN_PRODUCTION",
  "emailFrom": "info@my-node-api.com",
  "smtpOptions": {
    "host": "smtp.ethereal.email",
    "port": 587,
    "auth": {
      "user": "your_ethereal_user",
      "pass": "your_ethereal_pass"
    }
  }
}
```

*Tip: You can generate fake SMTP credentials for testing at [Ethereal Email](https://ethereal.email/).*

---

## Part 3: Helper Utilities

Create a folder named `_helpers` and add the following files.

### 1. Database Connection (`_helpers/db.ts`)

This file connects to MySQL and initializes our Sequelize models.

The MySQL database wrapper connects to MySQL using Sequelize and the MySQL2 client, and exports an object containing all of the database model objects in the application (currently only Account and RefreshToken). It provides an easy way to access any part of the database from a single point.

The `initialize()` function is executed once on api startup and performs the following actions:

- Connects to MySQL server using the mysql2 db client and executes a query to create the database if it doesn't already exist.
- Connects to the database with the Sequelize ORM.
- Initializes the Account and RefreshToken models and attaches them to the exported db object.
- Defines the one-to-many relationship between accounts and refresh tokens and configures refresh tokens to be deleted when the account they belong to is deleted.
- Automatically creates tables in MySQL database if they don't exist by calling `await sequelize.sync()`. For more info on Sequelize model synchronization options see https://sequelize.org/master/manual/model-basics.html#model-synchronization.

```typescript
import config from '../config.json';
import mysql from 'mysql2/promise';
import { Sequelize } from 'sequelize';
import accountModel from '../accounts/account.model';
import refreshTokenModel from '../accounts/refresh-token.model';

const db: any = {};
export default db;

initialize();

async function initialize() {
  const { host, port, user, password, database } = config.database;
  const connection = await mysql.createConnection({ host, port, user, password });

  // Create DB if it doesn't exist
  await connection.query(`CREATE DATABASE IF NOT EXISTS \`${database}\`;`);

  // Connect to DB
  const sequelize = new Sequelize(database, user, password, { dialect: 'mysql' });

  // Init models
  db.Account = accountModel(sequelize);
  db.RefreshToken = refreshTokenModel(sequelize);

  // Define relationships
  db.Account.hasMany(db.RefreshToken, { onDelete: 'CASCADE' });
  db.RefreshToken.belongsTo(db.Account);

  // Sync models with database
  await sequelize.sync();
}
```

### 2. Email Sender (`_helpers/send-email.ts`)

A simple wrapper around Nodemailer.

The send email helper is a lightweight wrapper around the nodemailer module to simplify sending emails from anywhere in the application. It is used by the account service to send account verification and password reset emails.

```typescript
import nodemailer from 'nodemailer';
import config from '../config.json';

export default async function sendEmail({ to, subject, html, from = config.emailFrom }: any) {
  const transporter = nodemailer.createTransport(config.smtpOptions);
  await transporter.sendMail({ from, to, subject, html });
}
```

### 3. Roles / Enum (`_helpers/role.ts`)

The role object defines all the roles in the example application. I created it to use like an enum to avoid passing roles around as strings, so instead of 'Admin' and 'User' we can use Role.Admin and Role.User.

```typescript
export default {
  Admin: 'Admin',
  User: 'User'
}
```

### 4. Swagger API Docs Route Handler (`/api-docs`)

Path: `/_helpers/swagger.js`

The Swagger docs route handler uses the Swagger UI Express module to serve auto-generated Swagger UI documentation based on the swagger.yaml file from the /api-docs path of the api. The route handler is bound to the /api-docs path in the main server.js file.

For more info on swagger-ui-express see https://www.npmjs.com/package/swagger-ui-express.

```typescript
import express from 'express';
const router = express.Router();
import swaggerUi from 'swagger-ui-express';
import YAML from 'yamljs';

const swaggerDocument = YAML.load('./swagger.yaml');

router.use('/', swaggerUi.serve, swaggerUi.setup(swaggerDocument));

export default router;
```

---

## Part 4: Middleware (`_middleware`)

The middleware folder contains Express.js middleware functions that can be used by different routes / features within the Node.js boilerplate api.

Create a folder named `_middleware` for logic that intercepts requests.

### 1. Global Error Handler Middleware (`_middleware/error-handler.ts`)

The global error handler is used to catch all errors and remove the need for duplicated error handling code throughout the boilerplate application. It's configured as middleware in the main server.js file.

By convention errors of type 'string' are treated as custom (app specific) errors, this simplifies the code for throwing custom errors since only a string needs to be thrown (e.g. `throw 'Invalid token'`). Further to this if a custom error ends with the words 'not found' a 404 response code is returned, otherwise a standard 400 response is returned. See the account service for some examples of custom errors thrown by the api, errors are caught in the accounts controller for each route and passed to `next(err)` which passes them to this global error handler.

```typescript
import { Request, Response, NextFunction } from 'express';

export default function errorHandler(err: any, req: Request, res: Response, next: NextFunction) {
  switch (true) {
    case typeof err === 'string':
      const is404 = err.toLowerCase().endsWith('not found');
      const statusCode = is404 ? 404 : 400;
      return res.status(statusCode).json({ message: err });
    case err.name === 'UnauthorizedError':
      return res.status(401).json({ message: 'Unauthorized' });
    default:
      return res.status(500).json({ message: err.message });
  }
}
```

### 2. Request Validation (`_middleware/validate-request.ts`)

The validate request middleware function validates the body of a request against a Joi schema object.

It is used by schema middleware functions in controllers to validate the request against the schema for a specific route (e.g. authenticateSchema in the accounts controller).

```typescript
export default validateRequest;

function validateRequest(req: any, next: any, schema: any) {
  const options = {
    abortEarly: false, // include all errors
    allowUnknown: true, // ignore unknown props
    stripUnknown: true // remove unknown props
  };
  const { error, value } = schema.validate(req.body, options);
  if (error) {
    next(`Validation error: ${error.details.map(x => x.message).join(', ')}`);
  } else {
    req.body = value;
    next();
  }
}
```

### 3. Authorization (`_middleware/authorize.ts`)

The authorize middleware can be added to any route to restrict access to the route to authenticated users with specified roles. If the roles parameter is omitted (i.e. `authorize()`) then the route will be accessible to all authenticated users regardless of role. It is used by the accounts controller to restrict access to account CRUD routes and revoke token routes.

The authorize function returns an array containing two middleware functions:

- The first (`jwt({ ... })`) authenticates the request by validating the JWT access token in the "Authorization" header of the http request. On successful authentication a user object is attached to the req object that contains the data from the JWT token, which in this example includes the user id (`req.user.id`).
- The second authorizes the request by checking that the authenticated account still exists and is authorized to access the requested route based on its role. The second middleware function also attaches the role property and the ownsToken method to the req.user object so they can be accessed by controller functions.

If either authentication or authorization fails then a 401 Unauthorized response is returned.

```typescript
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
```

### 4. Swagger Docs Router (`_helpers/swagger.ts`)

Swagger UI gives you a clickable web page for exploring and testing your API endpoints. In this project, we mount Swagger at `/api-docs`.

Create a `swagger.yaml` file in your project root (same folder as server.ts). You can start minimal and expand later:

```yaml
openapi: 3.0.0
info:
  title: Node MySQL API
  version: 1.0.0
servers:
  - url: http://localhost:4000
paths: {}
```

Create `_helpers/swagger.ts`:

```typescript
import express from 'express';
const router = express.Router();
import swaggerUi from 'swagger-ui-express';
import YAML from 'yamljs';

const swaggerDocument = YAML.load('./swagger.yaml');

router.use('/', swaggerUi.serve, swaggerUi.setup(swaggerDocument));

export default router;
```

---

## Part 5: The Accounts Module

Create an `accounts` folder. This is where our business logic lives.

### 1. Account Model (`accounts/account.model.ts`)

The account model uses Sequelize to define the schema for the accounts table in the MySQL database. The exported Sequelize model object gives full access to perform CRUD (create, read, update, delete) operations on accounts in MySQL, see the account service below for examples of it being used (via the db helper).

Fields with the type `DataTypes.VIRTUAL` are sequelize virtual fields that are not persisted in the database, they are convenience properties on the model that can include multiple field values (e.g. isVerified).

The `defaultScope` configures the model to exclude the password hash from query results by default. The `withHash` scope can be used to query accounts and include the password hash field in results.

The one-to-many relationship between accounts and refresh tokens is defined in the database wrapper.

Defines the structure of our User table.

```typescript
import { DataTypes } from 'sequelize';

export default function model(sequelize: any) {
  const attributes = {
    email: { type: DataTypes.STRING, allowNull: false },
    passwordHash: { type: DataTypes.STRING, allowNull: false },
    title: { type: DataTypes.STRING, allowNull: false },
    firstName: { type: DataTypes.STRING, allowNull: false },
    lastName: { type: DataTypes.STRING, allowNull: false },
    acceptTerms: { type: DataTypes.BOOLEAN },
    role: { type: DataTypes.STRING, allowNull: false },
    verificationToken: { type: DataTypes.STRING },
    verified: { type: DataTypes.DATE },
    resetToken: { type: DataTypes.STRING },
    resetTokenExpires: { type: DataTypes.DATE },
    passwordReset: { type: DataTypes.DATE },
    created: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    updated: { type: DataTypes.DATE },
    isVerified: {
      type: DataTypes.VIRTUAL,
      get() { return !!(this.verified || this.passwordReset); }
    }
  };

  const options = {
    timestamps: false,
    defaultScope: { attributes: { exclude: ['passwordHash'] } },
    scopes: { withHash: { attributes: {}, } }
  };

  return sequelize.define('account', attributes, options);
}
```

### 2. Refresh Token Model (`accounts/refresh-token.model.ts`)

The refresh token model uses Sequelize to define the schema for the refreshTokens table in the MySQL database. The exported Sequelize model object gives full access to perform CRUD (create, read, update, delete) operations on refresh tokens in MySQL, see the account service below for examples of it being used (via the db helper).

The `DataTypes.VIRTUAL` properties are convenience properties available on the sequelize model that don't get persisted to the MySQL database.

The one-to-many relationship between accounts and refresh tokens is defined in the database wrapper.

```typescript
import { DataTypes } from 'sequelize';

export default function model(sequelize: any) {
  const attributes = {
    token: { type: DataTypes.STRING },
    expires: { type: DataTypes.DATE },
    created: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    createdByIp: { type: DataTypes.STRING },
    revoked: { type: DataTypes.DATE },
    revokedByIp: { type: DataTypes.STRING },
    replacedByToken: { type: DataTypes.STRING },
    isExpired: {
      type: DataTypes.VIRTUAL,
      get() { return Date.now() >= this.expires; }
    },
    isActive: {
      type: DataTypes.VIRTUAL,
      get() { return !this.revoked && !this.isExpired; }
    }
  };

  const options = { timestamps: false };
  return sequelize.define('refreshToken', attributes, options);
}
```

### 3. Account Service (`accounts/account.service.ts`)

The account service contains the core business logic for account sign up & verification, authentication with JWT & refresh tokens, forgotten password & reset password functionality, as well as CRUD methods for managing account data. The service encapsulates all interaction with the sequelize account models and exposes a simple set of methods which are used by the accounts controller.

The top of the file contains the exported service object with just the method names to make it easy to see all the methods at a glance, the rest of the file contains the implementation functions for each service method, followed by local helper functions.

Create `accounts/account.service.ts`:

```typescript
import config from '../config.json';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { Op } from 'sequelize';
import sendEmail from '../_helpers/send-email';
import db from '../_helpers/db';
import Role from '../_helpers/role';

export default {
  authenticate,
  refreshToken,
  revokeToken,
  register,
  verifyEmail,
  forgotPassword,
  validateResetToken,
  resetPassword,
  getAll,
  getById,
  create,
  update,
  delete: _delete
};

async function authenticate({ email, password, ipAddress }: any) {
  const account = await db.Account.scope('withHash').findOne({ where: { email } });

  if (!account || !account.isVerified || !(await bcrypt.compare(password, account.passwordHash))) {
    throw 'Email or password is incorrect';
  }

  const jwtToken = generateJwtToken(account);
  const refreshToken = generateRefreshToken(account, ipAddress);

  await refreshToken.save();

  return {
    ...basicDetails(account),
    jwtToken,
    refreshToken: refreshToken.token
  };
}

async function refreshToken({ token, ipAddress }: any) {
  const refreshToken = await getRefreshToken(token);
  const account = await refreshToken.getAccount();

  const newRefreshToken = generateRefreshToken(account, ipAddress);
  refreshToken.revoked = Date.now();
  refreshToken.revokedByIp = ipAddress;
  refreshToken.replacedByToken = newRefreshToken.token;
  await refreshToken.save();
  await newRefreshToken.save();

  const jwtToken = generateJwtToken(account);

  return {
    ...basicDetails(account),
    jwtToken,
    refreshToken: newRefreshToken.token
  };
}

async function revokeToken({ token, ipAddress }: any) {
  const refreshToken = await getRefreshToken(token);

  refreshToken.revoked = Date.now();
  refreshToken.revokedByIp = ipAddress;
  await refreshToken.save();
}

async function register(params: any, origin: any) {
  if ((await db.Account.findOne({ where: { email: params.email } }))) {
    return await sendAlreadyRegisteredEmail(params.email, origin);
  }

  const account = new db.Account(params);

  const isFirstAccount = (await db.Account.count()) === 0;
  account.role = isFirstAccount ? Role.Admin : Role.User;
  account.verificationToken = randomTokenString();

  account.passwordHash = await hash(params.password);

  await account.save();

  await sendVerificationEmail(account, origin);
}

async function verifyEmail({ token }: any) {
  const account = await db.Account.findOne({ where: { verificationToken: token } });

  if (!account) throw 'Verification failed';

  account.verified = Date.now();
  account.verificationToken = null;
  await account.save();
}

async function forgotPassword({ email }: any, origin: any) {
  const account = await db.Account.findOne({ where: { email } });

  if (!account) return;

  account.resetToken = randomTokenString();
  account.resetTokenExpires = new Date(Date.now() + 24*60*60*1000);
  await account.save();

  await sendPasswordResetEmail(account, origin);
}

async function validateResetToken({ token }: any) {
  const account = await db.Account.findOne({
    where: {
      resetToken: token,
      resetTokenExpires: { [Op.gt]: Date.now() }
    }
  });

  if (!account) throw 'Invalid token';

  return account;
}

async function resetPassword({ token, password }: any) {
  const account = await validateResetToken({ token });

  account.passwordHash = await hash(password);
  account.passwordReset = Date.now();
  account.resetToken = null;
  await account.save();
}

async function getAll() {
  const accounts = await db.Account.findAll();
  return accounts.map((x: any) => basicDetails(x));
}

async function getById(id: any) {
  const account = await getAccount(id);
  return basicDetails(account);
}

async function create(params: any) {
  if ((await db.Account.findOne({ where: { email: params.email } }))) {
    throw 'Email "' + params.email + '" is already registered';
  }

  const account = new db.Account(params);
  account.verified = Date.now();

  account.passwordHash = await hash(params.password);

  await account.save();

  return basicDetails(account);
}

async function update(id: any, params: any) {
  const account = await getAccount(id);

  if (params.email && account.email !== params.email && await db.Account.findOne({ where: { email: params.email } })) {
    throw 'Email "' + params.email + '" is already taken';
  }

  if (params.password) {
    params.passwordHash = await hash(params.password);
  }

  Object.assign(account, params);
  account.updated = Date.now();
  await account.save();

  return basicDetails(account);
}

async function _delete(id: any) {
  const account = await getAccount(id);
  await account.destroy();
}

async function getAccount(id: any) {
  const account = await db.Account.findByPk(id);
  if (!account) throw 'Account not found';
  return account;
}

async function getRefreshToken(token: any) {
  const refreshToken = await db.RefreshToken.findOne({ where: { token } });
  if (!refreshToken || !refreshToken.isActive) throw 'Invalid token';
  return refreshToken;
}

async function hash(password: any) {
  return await bcrypt.hash(password, 10);
}

function generateJwtToken(account: any) {
  return jwt.sign({ sub: account.id, id: account.id }, config.secret, { expiresIn: '15m' });
}

function generateRefreshToken(account: any, ipAddress: any) {
  return new db.RefreshToken({
    accountId: account.id,
    token: randomTokenString(),
    expires: new Date(Date.now() + 7*24*60*60*1000),
    createdByIp: ipAddress
  });
}

function randomTokenString() {
  return crypto.randomBytes(40).toString('hex');
}

function basicDetails(account: any) {
  const { id, title, firstName, lastName, email, role, created, updated, isVerified } = account;
  return { id, title, firstName, lastName, email, role, created, updated, isVerified };
}

async function sendVerificationEmail(account: any, origin: any) {
  let message;
  if (origin) {
    const verifyUrl = `${origin}/account/verify-email?token=${account.verificationToken}`;
    message = `<p>Please click the below link to verify your email address:</p>
               <p><a href="${verifyUrl}">${verifyUrl}</a></p>`;
  } else {
    message = `<p>Please use the below token to verify your email address with the <code>/account/verify-email</code> api route:</p>
               <p><code>${account.verificationToken}</code></p>`;
  }

  await sendEmail({
    to: account.email,
    subject: 'Sign-up Verification API - Verify Email',
    html: `<h4>Verify Email</h4>
           <p>Thanks for registering!</p>
           ${message}`
  });
}

async function sendAlreadyRegisteredEmail(email: any, origin: any) {
  let message;
  if (origin) {
    message = `<p>If you don't know your password please visit the <a href="${origin}/account/forgot-password">forgot password</a> page.</p>`;
  } else {
    message = `<p>If you don't know your password you can reset it via the <code>/account/forgot-password</code> api route.</p>`;
  }

  await sendEmail({
    to: email,
    subject: 'Sign-up Verification API - Email Already Registered',
    html: `<h4>Email Already Registered</h4>
           <p>Your email <strong>${email}</strong> is already registered.</p>
           ${message}`
  });
}

async function sendPasswordResetEmail(account: any, origin: any) {
  let message;
  if (origin) {
    const resetUrl = `${origin}/account/reset-password?token=${account.resetToken}`;
    message = `<p>Please click the below link to reset your password, the link will be valid for 1 day:</p>
               <p><a href="${resetUrl}">${resetUrl}</a></p>`;
  } else {
    message = `<p>Please use the below token to reset your password with the <code>/account/reset-password</code> api route:</p>
               <p><code>${account.resetToken}</code></p>`;
  }

  await sendEmail({
    to: account.email,
    subject: 'Sign-up Verification API - Reset Password',
    html: `<h4>Reset Password Email</h4>
           ${message}`
  });
}
```

### 4. Accounts Controller (`accounts/accounts.controller.ts`)

The accounts controller defines all /accounts routes for the Node.js + MySQL boilerplate api, the route definitions are grouped together at the top of the file and the implementation functions are below, followed by local helper functions. The controller is bound to the /accounts path in the main server.js file.

Routes that require authorization include the middleware function `authorize()` and optionally specify a role (e.g. `authorize(Role.Admin)`, if a role is specified then the route is restricted to users in that role, otherwise the route is restricted to all authenticated users regardless of role. The auth logic is located in the authorized middleware.

The route functions revokeToken, getById, update and _delete include an extra custom authorization check to prevent non-admin users from accessing accounts other than their own. So regular user accounts (Role.User) have CRUD access to their own account but not to others, and admin accounts (Role.Admin) have full CRUD access to all accounts.

Routes that require schema validation include a middleware function with the naming convention `<route>Schema` (e.g. authenticateSchema). Each schema validation function defines a schema for the request body using the Joi library and calls `validateRequest(req, next, schema)` to ensure the request body is valid. If validation succeeds the request continues to the next middleware function (the route function), otherwise an error is returned with details of why validation failed. For more info about Joi schema validation see https://www.npmjs.com/package/joi.

Express is the web server used by the boilerplate api, it's one of the most popular web application frameworks for Node.js. For more info see https://expressjs.com/.

Create `accounts/accounts.controller.ts`:

```typescript
import express from 'express';
const router = express.Router();
import Joi from 'joi';
import validateRequest from '../_middleware/validate-request';
import authorize from '../_middleware/authorize';
import Role from '../_helpers/role';
import accountService from './account.service';

router.post('/authenticate', authenticateSchema, authenticate);
router.post('/refresh-token', refreshToken);
router.post('/revoke-token', authorize(), revokeTokenSchema, revokeToken);
router.post('/register', registerSchema, register);
router.post('/verify-email', verifyEmailSchema, verifyEmail);
router.post('/forgot-password', forgotPasswordSchema, forgotPassword);
router.post('/validate-reset-token', validateResetTokenSchema, validateResetToken);
router.post('/reset-password', resetPasswordSchema, resetPassword);
router.get('/', authorize(Role.Admin), getAll);
router.get('/:id', authorize(), getById);
router.post('/', authorize(Role.Admin), createSchema, create);
router.put('/:id', authorize(), updateSchema, update);
router.delete('/:id', authorize(), _delete);

export default router;

function authenticateSchema(req: any, res: any, next: any) {
  const schema = Joi.object({
    email: Joi.string().required(),
    password: Joi.string().required()
  });
  validateRequest(req, next, schema);
}

function authenticate(req: any, res: any, next: any) {
  const { email, password } = req.body;
  const ipAddress = req.ip;
  accountService.authenticate({ email, password, ipAddress })
    .then(({ refreshToken, ...account }: any) => {
      setTokenCookie(res, refreshToken);
      res.json(account);
    })
    .catch(next);
}

function refreshToken(req: any, res: any, next: any) {
  const token = req.cookies.refreshToken;
  const ipAddress = req.ip;
  accountService.refreshToken({ token, ipAddress })
    .then(({ refreshToken, ...account }: any) => {
      setTokenCookie(res, refreshToken);
      res.json(account);
    })
    .catch(next);
}

function revokeTokenSchema(req: any, res: any, next: any) {
  const schema = Joi.object({
    token: Joi.string().empty('')
  });
  validateRequest(req, next, schema);
}

function revokeToken(req: any, res: any, next: any) {
  const token = req.body.token || req.cookies.refreshToken;
  const ipAddress = req.ip;

  if (!token) return res.status(400).json({ message: 'Token is required' });

  if (!req.user.ownsToken(token) && req.user.role !== Role.Admin) {
    return res.status(401).json({ message: 'Unauthorized' });
  }

  accountService.revokeToken({ token, ipAddress })
    .then(() => res.json({ message: 'Token revoked' }))
    .catch(next);
}

function registerSchema(req: any, res: any, next: any) {
  const schema = Joi.object({
    title: Joi.string().required(),
    firstName: Joi.string().required(),
    lastName: Joi.string().required(),
    email: Joi.string().email().required(),
    password: Joi.string().min(6).required(),
    confirmPassword: Joi.string().valid(Joi.ref('password')).required(),
    acceptTerms: Joi.boolean().valid(true).required()
  });
  validateRequest(req, next, schema);
}

function register(req: any, res: any, next: any) {
  accountService.register(req.body, req.get('origin'))
    .then(() => res.json({ message: 'Registration successful, please check your email for verification instructions' }))
    .catch(next);
}

function verifyEmailSchema(req: any, res: any, next: any) {
  const schema = Joi.object({
    token: Joi.string().required()
  });
  validateRequest(req, next, schema);
}

function verifyEmail(req: any, res: any, next: any) {
  accountService.verifyEmail(req.body)
    .then(() => res.json({ message: 'Verification successful, you can now login' }))
    .catch(next);
}

function forgotPasswordSchema(req: any, res: any, next: any) {
  const schema = Joi.object({
    email: Joi.string().email().required()
  });
  validateRequest(req, next, schema);
}

function forgotPassword(req: any, res: any, next: any) {
  accountService.forgotPassword(req.body, req.get('origin'))
    .then(() => res.json({ message: 'Please check your email for password reset instructions' }))
    .catch(next);
}

function validateResetTokenSchema(req: any, res: any, next: any) {
  const schema = Joi.object({
    token: Joi.string().required()
  });
  validateRequest(req, next, schema);
}

function validateResetToken(req: any, res: any, next: any) {
  accountService.validateResetToken(req.body)
    .then(() => res.json({ message: 'Token is valid' }))
    .catch(next);
}

function resetPasswordSchema(req: any, res: any, next: any) {
  const schema = Joi.object({
    token: Joi.string().required(),
    password: Joi.string().min(6).required(),
    confirmPassword: Joi.string().valid(Joi.ref('password')).required()
  });
  validateRequest(req, next, schema);
}

function resetPassword(req: any, res: any, next: any) {
  accountService.resetPassword(req.body)
    .then(() => res.json({ message: 'Password reset successful, you can now login' }))
    .catch(next);
}

function getAll(req: any, res: any, next: any) {
  accountService.getAll()
    .then((accounts: any) => res.json(accounts))
    .catch(next);
}

function getById(req: any, res: any, next: any) {
  if (Number(req.params.id) !== req.user.id && req.user.role !== Role.Admin) {
    return res.status(401).json({ message: 'Unauthorized' });
  }

  accountService.getById(req.params.id)
    .then((account: any) => account ? res.json(account) : res.sendStatus(404))
    .catch(next);
}

function createSchema(req: any, res: any, next: any) {
  const schema = Joi.object({
    title: Joi.string().required(),
    firstName: Joi.string().required(),
    lastName: Joi.string().required(),
    email: Joi.string().email().required(),
    password: Joi.string().min(6).required(),
    confirmPassword: Joi.string().valid(Joi.ref('password')).required(),
    role: Joi.string().valid(Role.Admin, Role.User).required()
  });
  validateRequest(req, next, schema);
}

function create(req: any, res: any, next: any) {
  accountService.create(req.body)
    .then((account: any) => res.json(account))
    .catch(next);
}

function updateSchema(req: any, res: any, next: any) {
  const schemaRules: any = {
    title: Joi.string().empty(''),
    firstName: Joi.string().empty(''),
    lastName: Joi.string().empty(''),
    email: Joi.string().email().empty(''),
    password: Joi.string().min(6).empty(''),
    confirmPassword: Joi.string().valid(Joi.ref('password')).empty('')
  };

  if (req.user.role === Role.Admin) {
    schemaRules.role = Joi.string().valid(Role.Admin, Role.User).empty('');
  }

  const schema = Joi.object(schemaRules).with('password', 'confirmPassword');
  validateRequest(req, next, schema);
}

function update(req: any, res: any, next: any) {
  if (Number(req.params.id) !== req.user.id && req.user.role !== Role.Admin) {
    return res.status(401).json({ message: 'Unauthorized' });
  }

  accountService.update(req.params.id, req.body)
    .then((account: any) => res.json(account))
    .catch(next);
}

function _delete(req: any, res: any, next: any) {
  if (Number(req.params.id) !== req.user.id && req.user.role !== Role.Admin) {
    return res.status(401).json({ message: 'Unauthorized' });
  }

  accountService.delete(req.params.id)
    .then(() => res.json({ message: 'Account deleted successfully' }))
    .catch(next);
}

function setTokenCookie(res: any, token: any) {
  const cookieOptions = {
    httpOnly: true,
    expires: new Date(Date.now() + 7*24*60*60*1000)
  };
  res.cookie('refreshToken', token, cookieOptions);
}
```

At this point, you can wire the controller into Express by importing it in `server.ts` and enabling the `/accounts` route.

---

## Part 6: Bringing it together in `server.ts`

Create `server.ts` in the root of your project. This initializes the Express app and hooks up our routes and middleware.

```typescript
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

// allow cors requests from any origin and with credentials
app.use(cors({ origin: (origin, callback) => callback(null, true), credentials: true }));

// api routes
app.use('/accounts', accountsController);

// swagger docs route
app.use('/api-docs', swaggerDocs);

// global error handler
app.use(errorHandler);

// start server
const port = process.env.NODE_ENV === 'production' ? (process.env.PORT || 80) : 4000;
app.listen(port, () => console.log('Server listening on port ' + port));
```

Once your server is running, open Swagger UI at:

- http://localhost:4000/api-docs

## Running the Application

Now that you have written the core infrastructure, you can start your server:

```bash
npm run start:dev
```

---

## Part 7: Test the Node.js Boilerplate API with Postman

While Swagger UI is great for quick tests, Postman is the industry standard for testing APIs. Here is how you can test the entire flow using Postman.

### How to register a new account with Postman

To register a new account with the Node.js boilerplate api follow these steps:

1. Open a new request tab by clicking the plus (+) button at the end of the tabs.
2. Change the http request method to "POST" with the dropdown selector on the left of the URL input field.
3. In the URL field enter the address to the register route of your local API - `http://localhost:4000/accounts/register`
4. Select the "Body" tab below the URL field, change the body type radio button to "raw", and change the format dropdown selector to "JSON".
5. Enter a JSON object containing the required user properties in the "Body" textarea, e.g:

```json
{
  "title": "Mr",
  "firstName": "Admin",
  "lastName": "Gayo",
  "email": "admin@example.com",
  "password": "asdf1234",
  "confirmPassword": "asdf1234",
  "acceptTerms": true
}
```

6. Click the "Send" button, you should receive a "200 OK" response with a "registration successful" message in the response body.

### How to verify an account with Postman

To verify an account with the Node api follow these steps:

1. Open a new request tab by clicking the plus (+) button at the end of the tabs.
2. Change the http request method to "POST" with the dropdown selector on the left of the URL input field.
3. In the URL field enter the address to the authenticate route of your local API - `http://localhost:4000/accounts/verify-email`
4. Select the "Body" tab below the URL field, change the body type radio button to "raw", and change the format dropdown selector to "JSON".
5. Enter a JSON object containing the token received in the verification email (in the previous step) in the "Body" textarea, e.g:

```json
{
  "token": "REPLACE THIS WITH YOUR TOKEN"
}
```

6. Click the "Send" button, you should receive a "200 OK" response with a "verification successful" message in the response body.

### How to access an account if you forgot the password

To re-enable access to an account with a forgotten password you need to submit the email address of the account to the `/account/forgot-password` route, the route will then send a token to the email which will allow you to reset the password of the account in the next step.

Follow these steps in Postman if you forgot the password for an account:

- Open a new request tab by clicking the plus (+) button at the end of the tabs.
- Change the http request method to "POST" with the dropdown selector on the left of the URL input field.
- In the URL field enter the address to the authenticate route of your local API - `http://localhost:4000/accounts/forgot-password`
- Select the "Body" tab below the URL field, change the body type radio button to "raw", and change the format dropdown selector to "JSON".
- Enter a JSON object containing the email of the account with the forgotten password in the "Body" textarea, e.g:

```json
{
  "email": "admin@example.com"
}
```

- Click the "Send" button, you should receive a "200 OK" response with the message "Please check your email for password reset instructions" in the response body.

### How to reset the password of an account with Postman

To reset the password of an account with the api follow these steps:

1. Open a new request tab by clicking the plus (+) button at the end of the tabs.
2. Change the http request method to "POST" with the dropdown selector on the left of the URL input field.
3. In the URL field enter the address to the authenticate route of your local API - `http://localhost:4000/accounts/reset-password`
4. Select the "Body" tab below the URL field, change the body type radio button to "raw", and change the format dropdown selector to "JSON".
5. Enter a JSON object containing the password reset token received in the email from the forgot password step, along with a new password and matching confirmPassword, into the "Body" textarea, e.g:

```json
{
  "token": "REPLACE THIS WITH YOUR TOKEN",
  "password": "new-super-secret-password",
  "confirmPassword": "new-super-secret-password"
}
```

6. Click the "Send" button, you should receive a "200 OK" response with a "password reset successful" message in the response body.

### How to authenticate with Postman

To authenticate an account with the api and get a JWT token follow these steps:

- Open a new request tab by clicking the plus (+) button at the end of the tabs.
- Change the http request method to "POST" with the dropdown selector on the left of the URL input field.
- In the URL field enter the address to the authenticate route of your local API - `http://localhost:4000/accounts/authenticate`
- Select the "Body" tab below the URL field, change the body type radio button to "raw", and change the format dropdown selector to "JSON".
- Enter a JSON object containing the account email and password in the "Body" textarea:

```json
{
  "email": "admin@example.com",
  "password": "Asdf1234"
}
```

- Click the "Send" button, you should receive a "200 OK" response with the user details including a JWT token in the response body and a refresh token in the response cookies.
- Copy the JWT token value because we'll be using it in the next steps to make authenticated requests.

### How to get a list of all accounts with Postman

This is a secure request that requires a JWT authentication token from the authenticate step. The api route is restricted to admin users.

To get a list of all accounts from the Node boilerplate api follow these steps:

1. Open a new request tab by clicking the plus (+) button at the end of the tabs.
2. Change the http request method to "GET" with the dropdown selector on the left of the URL input field.
3. In the URL field enter the address to the users route of your local API - `http://localhost:4000/accounts`
4. Select the "Authorization" tab below the URL field, change the type to "Bearer Token" in the type dropdown selector, and paste the JWT token from the previous authenticate step into the "Token" field.
5. Click the "Send" button, you should receive a "200 OK" response containing a JSON array with all of the account records in the system.

### How to update an account with Postman

This is a secure request that requires a JWT authentication token from the authenticate step. Admin users can update any account including its role, while regular users are restricted to their own account and cannot update roles. Omitted or empty properties are not updated.

To update an account with the api follow these steps:

1. Open a new request tab by clicking the plus (+) button at the end of the tabs.
2. Change the http request method to "PUT" with the dropdown selector on the left of the URL input field.
3. In the URL field enter the address to the `/accounts/{id}` route with the id of the account you want to update, e.g - `http://localhost:4000/accounts/1`
4. Select the "Authorization" tab below the URL field, change the type to "Bearer Token" in the type dropdown selector, and paste the JWT token from the previous authenticate step into the "Token" field.
5. Select the "Body" tab below the URL field, change the body type radio button to "raw", and change the format dropdown selector to "JSON".
6. Enter a JSON object in the "Body" textarea containing the properties you want to update, for example to update the first and last names:

```json
{
  "firstName": "Wilson",
  "lastName": "Gayo"
}
```

7. Click the "Send" button, you should receive a "200 OK" response with the updated account details in the response body.

### How to use a refresh token to get a new JWT token

This step can only be done after the authenticate step because a valid refresh token cookie is required.

To use a refresh token cookie to get a new JWT token and a new refresh token follow these steps:

1. Open a new request tab by clicking the plus (+) button at the end of the tabs.
2. Change the http request method to "POST" with the dropdown selector on the left of the URL input field.
3. In the URL field enter the address to the refresh token route of your local API - `http://localhost:4000/accounts/refresh-token`
4. Click the "Send" button, you should receive a "200 OK" response with the account details including a new JWT token in the response body and a new refresh token in the response cookies.
5. Copy the JWT token value because we'll be using it in the next steps to make authenticated requests.

### How to revoke a refresh token with Postman

This is a secure request that requires a JWT authentication token from the authenticate (or refresh token) step. Admin users can revoke the tokens of any account, while regular users can only revoke their own tokens.

To revoke a refresh token so it can no longer be used to generate JWT tokens, follow these steps:

1. Open a new request tab by clicking the plus (+) button at the end of the tabs.
2. Change the http request method to "POST" with the dropdown selector on the left of the URL input field.
3. In the URL field enter the address to the authenticate route of your local API - `http://localhost:4000/accounts/revoke-token`
4. Select the "Authorization" tab below the URL field, change the type to "Bearer Token" in the type dropdown selector, and paste the JWT token from the previous authenticate (or refresh token) step into the "Token" field.
5. Select the "Body" tab below the URL field, change the body type radio button to "raw", and change the format dropdown selector to "JSON".
6. Enter a JSON object containing the active refresh token from the previous step in the "Body" textarea, e.g:

```json
{
  "token": "ENTER THE ACTIVE REFRESH TOKEN HERE"
}
```

7. Click the "Send" button, you should receive a "200 OK" response with the message Token revoked.

> **Note:** You can also revoke the token in the refreshToken cookie with the `/accounts/revoke-token` route, to revoke the refresh token cookie simply send the same request with an empty body.

### How to delete an account with Postman

This is a secure request that requires a JWT authentication token from the authenticate step. Admin users can delete any account, while regular users are restricted to their own account.

To delete an account with the api follow these steps:

1. Open a new request tab by clicking the plus (+) button at the end of the tabs.
2. Change the http request method to "DELETE" with the dropdown selector on the left of the URL input field.
3. In the URL field enter the address to the `/accounts/{id}` route with the id of the account you want to delete, e.g - `http://localhost:4000/accounts/1`
4. Select the "Authorization" tab below the URL field, change the type to "Bearer Token" in the type dropdown selector, and paste the JWT token from the previous authenticate step into the "Token" field.
5. Click the "Send" button, you should receive a "200 OK" response with the message "Account deleted successfully" in the response body.

**Check mysql cli:**

```sql
mysql> select * from accounts;
Empty set (0.00 sec)
```
