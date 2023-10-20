import {
  BatchProcessor,
  EventType,
  processPartialResponse,
} from '@aws-lambda-powertools/batch';
import type { LambdaInterface } from '@aws-lambda-powertools/commons';
import type {
  Context,
  EventBridgeEvent,
  SQSBatchResponse,
  SQSEvent,
  SQSRecord,
} from 'aws-lambda';
import { ObjectId } from 'mongodb';
import { getEmbedding, getMongoCollection } from '../commons/helpers';
import { logger, tracer } from '../commons/powertools';

class LambdaFunction implements LambdaInterface {
  #processor = new BatchProcessor(EventType.SQS);

  /**
   * Updates the document with the new plot_embedding field in MongoDB Atlas
   *
   * @param id - The document id as it appears in MongoDB
   * @param fullDocument - The full MongoDB document with the new plot_embedding field
   */
  @tracer.captureMethod({ subSegmentName: '### writeEmbedding' })
  async writeEmbedding(
    id: string,
    fullDocument: Record<string, unknown> & { plot: string },
  ) {
    const collection = await getMongoCollection();
    const response = await collection.replaceOne(
      {
        _id: new ObjectId(id),
      },
      fullDocument,
    );

    logger.debug('MongoDB response', { response });

    if (response.modifiedCount !== 1) {
      throw new Error('Unable to update document');
    }
  }

  /**
   * Receives a SQS record containing a MongoDB event, extracts the plot field and creates an embedding
   * using the Bedrock Runtime API. The embedding is then written back to MongoDB Atlas in the same document
   * as the `plot_embedding` field.
   *
   * @param record - The SQS record that contains the MongoDB event
   * @param lambdaContext - The Lambda context, used to check if the time is about to expire
   */
  async recordHandler(record: SQSRecord, lambdaContext: Context) {
    // Create a subsegment and add the message id as annotation, then add the message id to the logger for correlation
    const subsegment = tracer
      .getSegment()
      ?.addNewSubsegment('### recordHandler');
    subsegment?.addAnnotation('messageId', record.messageId);
    logger.appendKeys({ messageId: record.messageId });

    try {
      // Check if the time is about to expire, if so, throw an error to skip this record (and the rest of the batch - the record will be retried)
      if (lambdaContext.getRemainingTimeInMillis() < 1000) {
        logger.info('Time is about to expire, stopping processing');
        throw new Error('Time is about to expire, stopping processing');
      }

      // Parse the SQS record body and extract EventBridge payload
      const { body } = record;
      let payload: EventBridgeEvent<
        'MongoDB Database Trigger for sample_mflix.movies',
        {
          operationType: string;
          fullDocument: Record<string, unknown> & { plot: string };
          documentKey: { _id: string };
        }
      >;
      try {
        payload = JSON.parse(body);
      } catch (error) {
        throw new Error('Unable to parse SQS record', { cause: error });
      }

      // Extract the document id and the full document excluding the _id field
      const {
        documentKey: { _id: id },
        fullDocument: { _id, ...document },
      } = payload.detail;
      // Add the document id as annotation and to the logger for correlation
      subsegment?.addAnnotation('documentId', id);
      logger.appendKeys({ documentId: id });

      // Create the embedding using the plot field from the document by calling the Bedrock Runtime API
      try {
        document['plot_embedding'] = await getEmbedding(document.plot);
      } catch (error) {
        throw new Error('Unble to create embedding', { cause: error });
      }

      // Write the embedding back to MongoDB Atlas
      try {
        await this.writeEmbedding(id, document);
      } catch (error) {
        throw new Error('Unable to write embedding', { cause: error });
      }
    } catch (error) {
      if (error instanceof Error) {
        subsegment?.addError(error);
        logger.error(error.message, error);
      }
      throw error;
    } finally {
      subsegment?.close();
      logger.removeKeys(['documentId', 'messageId']);
    }
  }

  /**
   * Processes the SQS messages in batches using Powertools for AWS Lambda (TypeScript) Batch Processing utility.
   * Each SQS message contains a MongoDB event, the event is then processed by the `recordHandler` method.
   * The method parses the MongoDB document, extracts the plot field and creates an embedding using the Bedrock Runtime API.
   * The embedding is then written back to MongoDB Atlas in the same document as the `plot_embedding` field.
   *
   * @param event - The SQS event containing the MongoDB events coming from the MongoDB Trigger via EventBridge
   * @param context - The Lambda context
   */
  @logger.injectLambdaContext({ logEvent: true })
  @tracer.captureLambdaHandler()
  async handler(event: SQSEvent, context: Context): Promise<SQSBatchResponse> {
    return processPartialResponse(
      event,
      this.recordHandler.bind(this),
      this.#processor,
      {
        context,
      },
    );
  }
}

const lambda = new LambdaFunction();
export const handler = lambda.handler.bind(lambda);
