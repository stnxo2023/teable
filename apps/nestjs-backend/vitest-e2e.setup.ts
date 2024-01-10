import fs from 'fs';
import path from 'path';
import { Prisma, PrismaClient } from '@prisma/client';
import { DriverClient, getRandomString, parseDsn } from '@teable-group/core';
import bcrypt from 'bcrypt';
import dotenv from 'dotenv-flow';

interface ITestConfig {
  driver: string;
  email: string;
  userId: string;
  password: string;
  spaceId: string;
  baseId: string;
}

declare global {
  // eslint-disable-next-line no-var
  var testConfig: ITestConfig;
}

// 设置全局变量（如果需要）
globalThis.testConfig = {
  email: 'test@e2e.com',
  password: '12345678',
  userId: 'usrTestUserId',
  spaceId: 'spcTestSpaceId',
  baseId: 'bseTestBaseId',
  driver: DriverClient.Sqlite,
};

function prepareSqliteEnv() {
  if (!process.env.PRISMA_DATABASE_URL?.startsWith('file:')) {
    return;
  }
  const prevFilePath = process.env.PRISMA_DATABASE_URL.substring(5);
  const prevDir = path.dirname(prevFilePath);
  const baseName = path.basename(prevFilePath);

  const newFileName = 'test-' + getRandomString(12) + '-' + baseName;
  const newFilePath = path.join(prevDir, 'test', newFileName);

  process.env.PRISMA_DATABASE_URL = 'file:' + newFilePath;
  console.log('TEST PRISMA_DATABASE_URL:', process.env.PRISMA_DATABASE_URL);

  const dbPath = '../../packages/db-main-prisma/db/';
  const testDbPath = path.join(dbPath, 'test');
  if (!fs.existsSync(testDbPath)) {
    fs.mkdirSync(testDbPath, { recursive: true });
  }
  fs.copyFileSync(path.join(dbPath, baseName), path.join(testDbPath, newFileName));
}

async function setup() {
  console.log('node-env', process.env.NODE_ENV);
  dotenv.config({ path: '../nextjs-app' });

  const { email, password, spaceId, baseId, userId } = globalThis.testConfig;
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  const databaseUrl = process.env.PRISMA_DATABASE_URL!;

  console.log('database-url: ', databaseUrl);
  const { driver } = parseDsn(databaseUrl);
  console.log('driver: ', driver);
  globalThis.testConfig.driver = driver;

  prepareSqliteEnv();
  const prismaClient = new PrismaClient();

  const salt = await bcrypt.genSalt(10);
  const hashPassword = await bcrypt.hash(password, salt);
  // init data exists
  await prismaClient.$transaction(
    async (prisma) => {
      const existsEmail = await prisma.user.findFirst({ where: { email } });
      const existsSpace = await prisma.space.findFirst({ where: { id: spaceId } });
      const existsBase = await prisma.base.findFirst({ where: { id: baseId } });
      if (!existsEmail) {
        await prisma.user.create({
          data: {
            id: userId,
            name: email.split('@')[0],
            email,
            salt,
            password: hashPassword,
          },
        });
      }
      if (!existsSpace) {
        await prisma.space.create({
          data: {
            id: spaceId,
            name: 'test space',
            createdBy: userId,
            lastModifiedBy: userId,
          },
        });

        await prisma.collaborator.create({
          data: {
            spaceId,
            roleName: 'owner',
            userId,
            createdBy: userId,
            lastModifiedBy: userId,
          },
        });
      }
      if (!existsBase) {
        if (driver !== DriverClient.Sqlite) {
          await prisma.$executeRawUnsafe(`create schema if not exists "${baseId}"`);
          await prisma.$executeRawUnsafe(`revoke all on schema "${baseId}" from public`);
        }
        await prisma.base.create({
          data: {
            id: baseId,
            spaceId,
            name: 'test base',
            order: 1,
            createdBy: userId,
            lastModifiedBy: userId,
          },
        });
      }
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
  );
}

export default setup();