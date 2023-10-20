import { PT_VERSION as version } from '@aws-lambda-powertools/commons/lib/version';
import { Logger } from '@aws-lambda-powertools/logger';
import { Tracer } from '@aws-lambda-powertools/tracer';

const defaultValues = {
  awsAccountId: process.env.AWS_ACCOUNT_ID || 'N/A',
  environment: process.env.ENVIRONMENT || 'N/A',
};

const logger = new Logger({
  logLevel: defaultValues.environment === 'PROD' ? 'INFO' : 'DEBUG',
  persistentLogAttributes: {
    ...defaultValues,
    logger: {
      name: '@aws-lambda-powertools/logger',
      version,
    },
  },
});

const tracer = new Tracer();

export { logger, tracer };
