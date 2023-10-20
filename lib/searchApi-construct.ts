import { Stack } from 'aws-cdk-lib';
import {
  AuthorizationType,
  JsonSchemaType,
  LambdaIntegration,
  Model,
  RequestValidator,
  RestApi,
} from 'aws-cdk-lib/aws-apigateway';
import { Vpc } from 'aws-cdk-lib/aws-ec2';
import {
  AccountPrincipal,
  AnyPrincipal,
  ArnPrincipal,
  Effect,
  PolicyDocument,
  PolicyStatement,
  StarPrincipal,
} from 'aws-cdk-lib/aws-iam';
import { type NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { NagSuppressions } from 'cdk-nag';
import { Construct } from 'constructs';
import { FunctionConstruct } from './function-construct';

export interface SearchAPIConstructProps {
  /**
   * Rest API to be used by the construct to add the search routes, if not provided a new one will be created.
   * @default - A new Rest API is created
   */
  restApi?: RestApi;
  /**
   * The VPC where the Lambda functions will be deployed.
   */
  vpc: Vpc;
}

/**
 * Construct that contains the resources needed to expose the search functionality via a Rest API.
 * It creates a Rest API with two routes and two Lambda functions, one to search the MongoDB Atlas Vector Search index
 * and another one to create the initial embeddings.
 *
 * You can provide your own Rest API, and the construct will add the routes to it.
 */
export class SearchAPIConstruct extends Construct {
  /**
   * Reference to the Rest API.
   */
  restApi: RestApi;
  /**
   * Reference to the Lambda function that searches the MongoDB Atlas Vector Search index.
   */
  searchFunction: NodejsFunction;
  /**
   * Reference to the Lambda function that creates the initial embeddings.
   */
  createInitialEmbeddingsFunction: NodejsFunction;

  public constructor(
    scope: Construct,
    id: string,
    props: SearchAPIConstructProps,
  ) {
    super(scope, id);

    const { restApi, vpc } = props;

    // If no Rest API is provided, create a new one, otherwise use the provided one
    if (!restApi) {
      this.restApi = new RestApi(this, 'SearchAPI', {
        description: 'API for semantic search',
        policy: new PolicyDocument({
          statements: [
            new PolicyStatement({
              effect: Effect.ALLOW,
              principals: [
                new AccountPrincipal(Stack.of(this).account),
              ],
              actions: ['execute-api:Invoke'],
              resources: [
                'execute-api:/prod/GET/create-initial-embeddings',
                'execute-api:/prod/POST/search',
              ],
            }),
          ],
        }),
      });

      NagSuppressions.addResourceSuppressions(
        this.restApi,
        [
          {
            id: 'AwsSolutions-APIG2',
            reason: 'Request validation is applied to the methods',
          },
        ],
        true,
      );
      NagSuppressions.addResourceSuppressions(
        this.restApi,
        [
          {
            id: 'AwsSolutions-APIG3',
            reason:
              'Usage of a WAF has intentionally been omitted for this solution, customers can add their own WAF if they wish to do so',
          },
          {
            id: 'AwsSolutions-APIG6',
            reason:
              'Logging disabled intentionally to leave it up to the user given that there can only be one AWS::ApiGateway::Account per AWS account',
          },
          {
            id: 'AwsSolutions-APIG1',
            reason:
              'Logging disabled intentionally to leave it up to the user given that there can only be one AWS::ApiGateway::Account per AWS account',
          },
        ],
        true,
      );
    } else {
      this.restApi = restApi;
    }

    // Create the Lambda functions
    const searchFunction = new FunctionConstruct(this, 'SearchFunction', {
      vpc,
      entry: 'functions/search/index.ts',
    });
    this.searchFunction = searchFunction.lambdaFunction;

    const createInitialEmbeddingsFunction = new FunctionConstruct(
      this,
      'CreateInitialEmbeddingsFn',
      {
        vpc,
        entry: 'functions/createInitialEmbeddings/index.ts',
      },
    );
    this.createInitialEmbeddingsFunction =
      createInitialEmbeddingsFunction.lambdaFunction;

    // Add the routes to the Rest API
    const searchResource = this.restApi.root.addResource('search');
    searchResource.addMethod(
      'POST',
      new LambdaIntegration(this.searchFunction),
      {
        authorizationType: AuthorizationType.IAM,
        requestValidator: new RequestValidator(this, 'body-validator', {
          restApi: this.restApi,
          validateRequestBody: true,
          requestValidatorName: 'body-validator',
        }),
        requestModels: {
          'application/json': new Model(this, 'SearchRequestModel', {
            restApi: this.restApi,
            contentType: 'application/json',
            modelName: 'SearchRequestModel',
            schema: {
              type: JsonSchemaType.OBJECT,
              required: ['query'],
              properties: {
                query: {
                  type: JsonSchemaType.STRING,
                },
              },
            },
          }),
        },
      },
    );
    NagSuppressions.addResourceSuppressions(searchResource, [
      {
        id: 'AwsSolutions-COG4',
        reason: 'Method uses IAM Authorization instead',
      },
    ], true);

    const embedResource = this.restApi.root
      .addResource('create-initial-embeddings');
    embedResource.addMethod(
      'GET',
      new LambdaIntegration(this.createInitialEmbeddingsFunction),
      {
        authorizationType: AuthorizationType.IAM,
        requestParameters: {
          'method.request.querystring.count': true,
        },
        requestValidatorOptions: {
          requestValidatorName: 'querystring-validator',
          validateRequestParameters: true,
          validateRequestBody: false,
        },
      },
    );
    NagSuppressions.addResourceSuppressions(embedResource, [
      {
        id: 'AwsSolutions-COG4',
        reason: 'Method uses IAM Authorization instead',
      },
    ], true);
  }
}
