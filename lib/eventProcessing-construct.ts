import { Duration, RemovalPolicy } from 'aws-cdk-lib';
import { type Vpc } from 'aws-cdk-lib/aws-ec2';
import { EventBus, type IEventBus, Match, Rule } from 'aws-cdk-lib/aws-events';
import { CloudWatchLogGroup, SqsQueue } from 'aws-cdk-lib/aws-events-targets';
import { SqsEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';
import { type NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { LogGroup, RetentionDays } from 'aws-cdk-lib/aws-logs';
import { Queue } from 'aws-cdk-lib/aws-sqs';
import { Construct } from 'constructs';
import { FunctionConstruct } from './function-construct';

export interface EventProcessingConstructProps {
  /**
   * The VPC where the Lambda functions will be deployed.
   */
  vpc: Vpc;
  /**
   * Name of the EventBridge Partner Event Bus where the MongoDB Atlas Trigger will send events to.
   */
  eventBridgePartnerEventBusName: string;
}

/**
 * Construct that contains all the resources required to process events from MongoDB Atlas.
 * The events are sent by MongoDB Atlas Trigger to an Amazon EventBridge Event Bus which has
 * a SQS Queue as a target. The SQS Queue is then used as an event source for a Lambda function
 * that will create the embeddings and write them to MongoDB Atlas.
 *
 * The construct also contains a catch-all rule that forwards all events to CloudWatch Logs
 * for debugging purposes, as well as a DLQ to store events that failed to be processed.
 *
 * @note - the construct requires a VPC with at least one private isolated subnet as well as
 * the name of the EventBridge Partner Event Bus set as a CloudFormation parameter.
 */
export class EventProcessingConstruct extends Construct {
  /**
   * Reference to the Lambda function used to create the embeddings and write them to MongoDB Atlas
   */
  public embedFunction: NodejsFunction;
  /**
   * Reference to the SQS Queue used to store events from MongoDB Atlas
   */
  public eventQueue: Queue;
  /**
   * Reference to the SQS Queue used to store events from MongoDB Atlas that failed to be processed
   */
  public dlqEventQueue: Queue;
  /**
   * Reference to the EventBridge Partner Event Bus where the MongoDB Atlas Trigger will send events to
   */
  public eventBus: IEventBus;

  public constructor(
    scope: Construct,
    id: string,
    props: EventProcessingConstructProps,
  ) {
    super(scope, id);

    const { vpc, eventBridgePartnerEventBusName } = props;

    // EventBridge Partner Event Bus, this is where the MongoDB Atlas Trigger will send events to
    this.eventBus = EventBus.fromEventBusName(
      this,
      'MongoDBAtlasEventBus',
      eventBridgePartnerEventBusName,
    );

    // SQS DLQ to store events from MongoDB Atlas
    this.dlqEventQueue = new Queue(this, 'DeadLetterQueue', {
      visibilityTimeout: Duration.minutes(2),
      enforceSSL: true,
    });
    // SQS Queue to store events from MongoDB Atlas
    this.eventQueue = new Queue(this, 'EventQueue', {
      retentionPeriod: Duration.days(1),
      visibilityTimeout: Duration.minutes(2),
      deadLetterQueue: {
        maxReceiveCount: 3,
        queue: this.dlqEventQueue,
      },
      enforceSSL: true,
    });

    const embedFunction = new FunctionConstruct(this, 'EmbedFunction', {
      entry: 'functions/embed/index.ts',
      vpc,
    });
    this.embedFunction = embedFunction.lambdaFunction;
    this.embedFunction.addEventSource(
      new SqsEventSource(this.eventQueue, {
        batchSize: 10,
        maxBatchingWindow: Duration.seconds(5),
        reportBatchItemFailures: true,
      }),
    );

    // Catch-all rule to forward all events to different targets
    new Rule(this, 'LogAllEventsRule', {
      enabled: true,
      eventBus: this.eventBus,
      eventPattern: {
        source: Match.prefix('aws.partner/mongodb.com'),
      },
      targets: [
        // Forward all events to CloudWatch Logs for debugging purposes
        new CloudWatchLogGroup(
          new LogGroup(this, 'EventBusLogGroup', {
            logGroupName: `/aws/events/${this.eventBus.eventBusName}`,
            removalPolicy: RemovalPolicy.DESTROY,
            retention: RetentionDays.ONE_WEEK,
          }),
        ),
        // Forward all events to an SQS Queue for batch processing
        new SqsQueue(this.dlqEventQueue),
      ],
    });
  }
}
