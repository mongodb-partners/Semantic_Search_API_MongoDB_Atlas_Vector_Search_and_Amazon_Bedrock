import type { LambdaInterface } from '@aws-lambda-powertools/commons';
import type { APIGatewayEvent, Context } from 'aws-lambda';
import { MONGODB_SEARCH_INDEX_NAME } from '../commons/constants';
import { getEmbedding, getMongoCollection } from '../commons/helpers';
import { logger, tracer } from '../commons/powertools';

class LambdaFunction implements LambdaInterface {
  /**
   * Searches the MongoDB Atlas Vector Search index for the nearest neighbors of the embedding.
   *
   * @param embedding - The embedding to use for the vector search
   */
  @tracer.captureMethod({
    subSegmentName: '### knnSearch',
    captureResponse: false,
  })
  async knnSearch(embedding: number[]) {
    const collection = await getMongoCollection();
    const results = await collection
      .aggregate([
        {
          $search: {
            index: MONGODB_SEARCH_INDEX_NAME,
            knnBeta: {
              vector: embedding,
              path: 'plot_embedding',
              k: 3,
            },
          },
        },
        {
          $project: {
            title: 1,
            plot: 1,
            score: { $meta: 'searchScore' },
          },
        },
      ])
      .toArray();

    logger.info('Results found', { lenght: results.length });

    return results;
  }

  /**
   * Receives a request from API Gateway, extracts the query and searches the MongoDB Atlas Vector Search index
   * for the nearest neighbors of the embedding of the query, then returns the results.
   *
   * @param event - The API Gateway request event
   * @param _context - The Lambda context (unused)
   */
  @logger.injectLambdaContext({ logEvent: true })
  @tracer.captureLambdaHandler({ captureResponse: false })
  async handler(
    event: APIGatewayEvent,
    _context: Context,
  ): Promise<{ statusCode: number; body: string }> {
    try {
      const { body } = event;
      const { query } = JSON.parse(body || '{}');
      logger.debug('query', { query });

      let embedding: number[];
      try {
        embedding = await getEmbedding(query);
        if (!embedding) {
          throw new Error('Empty embedding returned by the API');
        }
      } catch (error) {
        throw new Error('Unable to get embedding', { cause: error });
      }

      let items: unknown[];
      try {
        items = await this.knnSearch(embedding);
      } catch (error) {
        throw new Error('Unable to get embedding or search index', {
          cause: error,
        });
      }

      return {
        statusCode: 200,
        body: JSON.stringify(items),
      };
    } catch (error) {
      logger.error('Unble to get embedding or search index', error as Error);

      return {
        statusCode: 500,
        body: JSON.stringify({
          message:
            'An error occurred while searching the movies, please try again later.',
        }),
      };
    }
  }
}

const lambda = new LambdaFunction();
export const handler = lambda.handler.bind(lambda);
