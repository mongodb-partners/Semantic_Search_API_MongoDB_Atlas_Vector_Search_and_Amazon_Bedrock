import { Duration, Stack } from 'aws-cdk-lib';
import { SubnetType, type Vpc } from 'aws-cdk-lib/aws-ec2';
import {
  Effect,
  PolicyDocument,
  PolicyStatement,
  Role,
  ServicePrincipal,
} from 'aws-cdk-lib/aws-iam';
import { Runtime, Tracing } from 'aws-cdk-lib/aws-lambda';
import {
  NodejsFunction,
  type NodejsFunctionProps,
} from 'aws-cdk-lib/aws-lambda-nodejs';
import { NagSuppressions } from 'cdk-nag';
import { Construct } from 'constructs';

export interface FunctionConstructProps extends NodejsFunctionProps {
  /**
   * The VPC where the Lambda functions will be deployed.
   */
  vpc: Vpc;
}

/**
 * Construct that contains the resources required to create a Lambda function.
 * This is a reusable construct that is used by the other constructs to create the Lambda functions.
 */
export class FunctionConstruct extends Construct {
  /**
   * Reference to the Lambda function.
   */
  public lambdaFunction: NodejsFunction;

  public constructor(
    scope: Construct,
    id: string,
    props: FunctionConstructProps,
  ) {
    super(scope, id);

    const { vpc, environment, ...otherProps } = props;

    const role = new Role(this, 'LambdaRole', {
      assumedBy: new ServicePrincipal('lambda.amazonaws.com'),
      inlinePolicies: {
        ObservabilityPolicy: new PolicyDocument({
          statements: [
            new PolicyStatement({
              effect: Effect.ALLOW,
              actions: [
                'logs:CreateLogGroup',
                'logs:CreateLogStream',
                'logs:PutLogEvents',
              ],
              resources: [
                `arn:aws:logs:${Stack.of(this).region}:${
                  Stack.of(this).account
                }:log-group:/aws/lambda/*`,
              ],
            }),
          ],
        }),
        VPCPolicy: new PolicyDocument({
          statements: [
            new PolicyStatement({
              effect: Effect.ALLOW,
              actions: [
                'ec2:CreateNetworkInterface',
                'ec2:DescribeNetworkInterfaces',
                'ec2:DeleteNetworkInterface',
              ],
              resources: [
                `arn:aws:logs:${Stack.of(this).region}:${
                  Stack.of(this).account
                }:*`,
              ],
            }),
          ],
        }),
        BedrockPolicy: new PolicyDocument({
          statements: [
            new PolicyStatement({
              effect: Effect.ALLOW,
              actions: ['bedrock:InvokeModel'],
              resources: [
                `arn:aws:bedrock:us-east-1::foundation-model/amazon.titan-embed-text-v1`,
              ],
            }),
          ],
        }),
      },
    });
    NagSuppressions.addResourceSuppressions(role, [
      {
        id: 'AwsSolutions-IAM5',
        reason:
          'Wildcards are used because the Lambda function name is not known, as well as the VPC resources, and the Bedrock model resource',
      },
    ], true);

    this.lambdaFunction = new NodejsFunction(this, 'LambdaFunction', {
      ...otherProps,
      runtime: Runtime.NODEJS_18_X,
      vpc: vpc,
      vpcSubnets: vpc.selectSubnets({
        subnetType: SubnetType.PRIVATE_ISOLATED,
      }),
      environment: {
        POWERTOOLS_SERVICE_NAME: 'mongodb-bedrock-semantic-search',
        AWS_ACCOUNT_ID: Stack.of(this).account,
        ENVIRONMENT: Stack.of(this).node.tryGetContext('environment') || 'dev',
        LOG_LEVEL: 'DEBUG',
        ...(environment || {}),
      },
      tracing: Tracing.ACTIVE,
      timeout: Duration.minutes(2),
      memorySize: 256,
      bundling: {
        // Force bundling the AWS SDK v3
        externalModules: [],
        minify: true,
        sourceMap: true,
        keepNames: true,
        sourcesContent: false,
        buildArgs: {
          treeShaking: 'true',
          mainFields: 'module,main',
        },
      },
      role,
    });
    NagSuppressions.addResourceSuppressions(this.lambdaFunction.role!, [
      {
        id: 'AwsSolutions-IAM5',
        reason:
          'Wildcards are used becuase X-Ray does not support resource-level permission',
      },
    ], true);
  }
}
