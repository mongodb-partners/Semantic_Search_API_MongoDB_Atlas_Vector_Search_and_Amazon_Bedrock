import { Transform } from '@aws-lambda-powertools/parameters';
import { getSecret } from '@aws-lambda-powertools/parameters/secrets';
import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from '@aws-sdk/client-bedrock-runtime';
import {
  SendMessageBatchCommand,
  type SendMessageBatchCommandInput,
  SQSClient,
} from '@aws-sdk/client-sqs';
import { Collection, MongoClient, ServerApiVersion } from 'mongodb';
import {
  BEDROCK_MODEL_ID,
  MONGODB_COLLECTION_NAME,
  MONGODB_DATABASE_NAME,
} from './constants';
import { logger, tracer } from './powertools';

/**
 * Retrieves a string from the environment variables, throws an error if the variable is not set.
 *
 * @param name - The name of the environment variable to retrieve
 */
const getStringFromEnv = (name: string): string => {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set`);
  }

  return value;
};

let mongoClient: MongoClient;
let collection: Collection;
/**
 * Creates a MongoDB client and returns a collection object. If the client is already created,
 * returns the existing collection object.
 *
 * The connection string is retrieved from Secrets Manager using the Parameters utility from
 * the AWS Lambda Powertools (TypeScript).
 */
const getMongoCollection = async () => {
  if (!mongoClient) {
    const mongoDBSecretName = getStringFromEnv(
      'MONGODB_CONNECTION_STRING_SECRET_NAME',
    );
    const secret = await getSecret<{ url: string }>(mongoDBSecretName, {
      transform: Transform.JSON,
    });

    if (!secret) {
      throw new Error('MongoDB connection string not found');
    }

    mongoClient = new MongoClient(secret.url, {
      connectTimeoutMS: 5000,
    });

    mongoClient.connect();
    collection = mongoClient
      .db(MONGODB_DATABASE_NAME)
      .collection(MONGODB_COLLECTION_NAME);
  }

  return collection;
};

process.on('SIGTERM', async () => {
  logger.info('Closing MongoDB connection');
  await mongoClient.close();
  process.exit(0);
});

/**
 * Bedrock Runtime client instrumented using the Tracer utility from
 * Powertools for AWS Lambda (TypeScript) to send trace data to AWS X-Ray.
 *
 * @note - the region is hardcoded to `us-east-1` because at the time of
 * writing, the Bedrock Runtime is available in `us-east-1`.
 */
const bedrockClient = tracer.captureAWSv3Client(
  new BedrockRuntimeClient({
    region: 'us-east-1',
  }),
);

/**
 * Calls the Bedrock Runtime API to create an embedding for the given text.
 *
 * @param inputText - The text to embed
 */
const createEmbedding = async (inputText: string): Promise<number[]> => {
  const handlerSubsegment = tracer.getSegment();
  const subsegment = handlerSubsegment?.addNewSubsegment('### getEmbedding');
  subsegment && tracer.setSegment(subsegment);
  try {
    const response = await bedrockClient.send(
      new InvokeModelCommand({
        modelId: BEDROCK_MODEL_ID,
        accept: '*/*',
        contentType: 'application/json',
        body: JSON.stringify({
          inputText,
        }),
      }),
    );

    if (response.$metadata.httpStatusCode !== 200 || !response.body) {
      throw new Error('Error in model response');
    }

    const body = response.body;
    const { embedding } = JSON.parse(new TextDecoder().decode(body));

    return embedding;
  } catch (error) {
    logger.error('Unable to invoke model', error as Error);

    throw error;
  } finally {
    subsegment?.close();
    handlerSubsegment && tracer.setSegment(handlerSubsegment);
  }
};

/**
 * SQS client instrumented using the Tracer utility from Powertools for AWS Lambda (TypeScript)
 * to send trace data to AWS X-Ray.
 */
const sqsClient = tracer.captureAWSv3Client(new SQSClient({}));

/**
 * Sends a batch of messages to SQS.
 *
 * @param batch - The batch of messages to send to SQS
 */
const sendMessagesToQueue = async (
  batch: SendMessageBatchCommandInput['Entries'],
): Promise<void> => {
  const queueUrl = getStringFromEnv('EVENTS_QUEUE_URL');
  await sqsClient.send(
    new SendMessageBatchCommand({
      QueueUrl: queueUrl,
      Entries: batch,
    }),
  );
};

export {
  createEmbedding as getEmbedding,
  getMongoCollection,
  sendMessagesToQueue,
};
