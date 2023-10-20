import { CfnParameter, Stack, type StackProps } from 'aws-cdk-lib';
import { NagSuppressions } from 'cdk-nag';
import { Construct } from 'constructs';
import { EventProcessingConstruct } from './eventProcessing-construct';
import { NetworkConstruct } from './network-construct';
import { SearchAPIConstruct } from './searchApi-construct';
import { SecretsConstruct } from './secrets-construct';

export class MongodbBedrockSemanticSearchStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // Name of the secret that contains the MongoDB Atlas connection string
    const mongoDBConnectionStringSecretName = new CfnParameter(
      this,
      'MongoDBConnectionStringSecretName',
      {
        type: 'String',
        description:
          'The name of the secret that contains the MongoDB Atlas connection string',
      },
    );

    // EventBridge Partner Event Source Parameter, this is where the MongoDB Trigger will send events
    const eventBridgePartnerEventBusName = new CfnParameter(
      this,
      'EventBridgePartnerEventBusName',
      {
        type: 'String',
        description:
          'The name of the EventBridge Event Bus associated to the MongoDB Partner Event Source',
      },
    );

    const { mongoDBConnectionStringSecret } = new SecretsConstruct(
      this,
      'Secrets',
      {
        mongoDBConnectionStringSecretName:
          mongoDBConnectionStringSecretName.valueAsString,
      },
    );
    const { vpc } = new NetworkConstruct(this, 'Network', {});
    const { embedFunction, eventQueue } = new EventProcessingConstruct(
      this,
      'EventProcessing',
      {
        vpc,
        eventBridgePartnerEventBusName:
          eventBridgePartnerEventBusName.valueAsString,
      },
    );
    const { searchFunction, createInitialEmbeddingsFunction } =
      new SearchAPIConstruct(this, 'SearchAPI', {
        vpc,
      });

    // Grant all the Lambda functions permission to read the MongoDB Atlas connection string secret
    [embedFunction, searchFunction, createInitialEmbeddingsFunction].forEach(
      (fn) => {
        mongoDBConnectionStringSecret.grantRead(fn);
        fn.addEnvironment(
          'MONGODB_CONNECTION_STRING_SECRET_NAME',
          mongoDBConnectionStringSecret.secretName,
        );
      },
    );
    // Grant the Lambda function that creates the initial embeddings permission to send messages to the SQS Queue
    eventQueue.grantSendMessages(createInitialEmbeddingsFunction);
    createInitialEmbeddingsFunction.addEnvironment(
      'EVENTS_QUEUE_URL',
      eventQueue.queueUrl,
    );

    NagSuppressions.addResourceSuppressionsByPath(
      this,
      [
        'MongodbBedrockSemanticSearchStack/EventsLogGroupPolicyMongodbBedrockSemanticSearchStackEventProcessingLogAllEventsRule686DD0B8/CustomResourcePolicy/Resource',
        'MongodbBedrockSemanticSearchStack/AWS679f53fac002430cb0da5b7982bd2287/ServiceRole/Resource',
      ],
      [
        {
          id: 'AwsSolutions-L1',
          reason:
            'This resource is created and managed by CDK and is used only at deployment time.',
        },
        {
          id: 'AwsSolutions-IAM4',
          reason:
            'This resource is created and managed by CDK and is used only at deployment time.',
        },
        {
          id: 'AwsSolutions-IAM5',
          reason:
            'This resource is created and managed by CDK and is used only at deployment time.',
        },
      ],
    );
  }
}
