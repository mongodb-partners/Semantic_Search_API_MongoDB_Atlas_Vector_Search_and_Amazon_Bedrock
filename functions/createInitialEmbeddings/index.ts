import type { LambdaInterface } from '@aws-lambda-powertools/commons';
import type { SendMessageBatchCommandInput } from '@aws-sdk/client-sqs';
import type { APIGatewayEvent, Context } from 'aws-lambda';
import type { Document, WithId } from 'mongodb';
import { randomUUID } from 'node:crypto';
import { getMongoCollection, sendMessagesToQueue } from '../commons/helpers';
import { logger, tracer } from '../commons/powertools';

class LambdaFunction implements LambdaInterface {
  /**
   * Reads documents from MongoDB Atlas that have a `plot` field but no `plot_embedding` field,
   * these are the documents that need to be processed.
   *
   * @param count - The number of documents to read from MongoDB
   */
  @tracer.captureMethod({
    subSegmentName: '### readDocuments',
    captureResponse: false,
  })
  async readDocuments(count: number): Promise<WithId<Document>[]> {
    const collection = await getMongoCollection();
    const documents = await collection
      .find({ plot: { $exists: true }, plot_embedding: { $exists: false } })
      .limit(count)
      .toArray();

    logger.info('Documents read', { lenght: documents.length });

    return documents;
  }

  /**
   * Sends the documents to SQS in batches using a reduced EventBridge format.
   *
   * @param documents - The documents to send to SQS
   * @param batchSize - The number of documents to send in each batch
   */
  @tracer.captureMethod({ subSegmentName: '### sendToQueueInBatches' })
  async sendToQueueInBatches(
    documents: WithId<Document>[],
    batchSize: number = 10,
  ): Promise<number> {
    let sentCount = 0;
    let batch: SendMessageBatchCommandInput['Entries'] = [];
    for (const document of documents) {
      batch.push({
        Id: randomUUID(),
        MessageBody: JSON.stringify({
          version: '0',
          id: randomUUID(),
          'detail-type': 'MongoDB Database Trigger for sample_mflix.movies',
          detail: {
            operationType: 'update',
            fullDocument: document,
            documentKey: { _id: document._id },
          },
        }),
      });
      if (batch.length === batchSize) {
        await sendMessagesToQueue(batch);
        sentCount += batch.length;
        batch = [];
      }
    }

    return sentCount;
  }

  /**
   * Receives an API Gateway event and reads documents from MongoDB Atlas that have a `plot` field but no `plot_embedding` field,
   * these are the documents that need to be processed. The documents are then sent to SQS in batches using a reduced EventBridge format.
   *
   * Via the `count` query string parameter, you can specify how many documents to read from MongoDB Atlas.
   * @example
   * ```sh
   * curl --request POST \
   * 'https://<api-id>.execute-api.us-east-1.amazonaws.com/prod/create-initial-embeddings?count=10' \
   * --aws-sigv4 "aws:amz:us-east-1:execute-api" \
   * --user "${AWS_ACCESS_KEY_ID}:${AWS_SECRET_ACCESS_KEY}" \
   * --header "x-amz-security-token: ${AWS_SESSION_TOKEN}" \
   * --header 'Accept: application/json' \
   * | jq .
   * ```
   *
   * @param event - API Gateway event
   * @param _context - Lambda context (unused)
   */
  @logger.injectLambdaContext({ logEvent: true })
  @tracer.captureLambdaHandler()
  async handler(
    event: APIGatewayEvent,
    _context: Context,
  ): Promise<{ statusCode: 200; body: string }> {
    const { body, queryStringParameters } = event;
    const { count } = queryStringParameters || {};

    try {
      const documents = await this.readDocuments(count ? parseInt(count) : 50);
      const sentCount = await this.sendToQueueInBatches(documents);

      return {
        statusCode: 200,
        body: JSON.stringify({
          read: documents.length,
          sent: sentCount,
        }),
      };
    } catch (error) {
      logger.error('Unble to get embedding or search index', error as Error);
      throw error;
    }
  }
}

const lambda = new LambdaFunction();
export const handler = lambda.handler.bind(lambda);
