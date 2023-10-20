import { CfnOutput, Stack } from 'aws-cdk-lib';
import {
  FlowLogDestination,
  FlowLogTrafficType,
  Peer,
  Port,
  SecurityGroup,
  SubnetType,
  Vpc,
} from 'aws-cdk-lib/aws-ec2';
import { NagSuppressions } from 'cdk-nag';
import { Construct } from 'constructs';

export interface NetworkConstructProps {
  /**
   * VPC to be used by the construct, it requires at least one private isolated subnet.
   * @default - A new VPC is created
   */
  vpc?: Vpc;
}

/**
 * Construct that contains the networking resources required by the solution.
 * It creates a VPC with a single private isolated subnet and VPC Endpoints to access
 * Amazon SQS, Amazon Secrets Manager and Bedrock Runtime privately.
 *
 * @note - You can provide your own VPC, however the VPC must have at least one private isolated subnet.
 */
export class NetworkConstruct extends Construct {
  /**
   * Reference to the VPC where the private resources are deployed.
   */
  vpc: Vpc;

  constructor(scope: Construct, id: string, props: NetworkConstructProps) {
    super(scope, id);

    const { vpc } = props;

    if (!vpc) {
      // VPC that contains your private AWS resources - contains only one private subnet in a single AZ
      this.vpc = new Vpc(this, 'VPC', {
        maxAzs: 1,
        subnetConfiguration: [
          {
            cidrMask: 24,
            name: 'Private',
            subnetType: SubnetType.PRIVATE_ISOLATED,
          },
        ],
        flowLogs: {
          VPCFlowLogs: {
            destination: FlowLogDestination.toCloudWatchLogs(),
            trafficType: FlowLogTrafficType.REJECT,
          },
        },
      });
    } else {
      this.vpc = vpc;
    }

    // VPC Endpoints to access Amazon SQS, Amazon Secrets Manager and Bedrock Runtime privately
    [
      ['BedrockEndpoint', 'com.amazonaws.us-east-1.bedrock-runtime'],
      ['SecretsManagerEndpoint', 'com.amazonaws.us-east-1.secretsmanager'],
      ['SQSEndpoint', 'com.amazonaws.us-east-1.sqs'],
    ].forEach(([id, name]) => {
      this.vpc.addInterfaceEndpoint(id, {
        service: {
          name: name,
          privateDnsDefault: true,
          port: 443,
        },
        subnets: this.vpc.selectSubnets({
          subnetType: SubnetType.PRIVATE_ISOLATED,
        }),
      });
    });

    // Security group for the MongoDB Atlas Endpoint
    const securityGroup = new SecurityGroup(
      this,
      'MongoDBAtlasEndpointSecurityGroup',
      {
        vpc: this.vpc,
        allowAllOutbound: false,
      },
    );
    securityGroup.connections.allowFrom(
      Peer.ipv4(this.vpc.vpcCidrBlock),
      Port.allTcp(),
      'Allow access from the VPC CIDR block',
    );

    // Outputs containing the VPC ID and the private subnet ID
    new CfnOutput(this, 'VPCID', {
      value: this.vpc.vpcId,
    });
    new CfnOutput(this, 'VPCPrivateSubnetID', {
      value: this.vpc.selectSubnets({
        subnetType: SubnetType.PRIVATE_ISOLATED,
      }).subnetIds[0],
    });
    new CfnOutput(this, 'MongoDBAtlasEndpointSecurityGroupID', {
      value: securityGroup.securityGroupId,
    });

    NagSuppressions.addResourceSuppressionsByPath(
      Stack.of(this),
      [
        '/MongodbBedrockSemanticSearchStack/Network/VPC/BedrockEndpoint/SecurityGroup/Resource',
        '/MongodbBedrockSemanticSearchStack/Network/VPC/SecretsManagerEndpoint/SecurityGroup/Resource',
        '/MongodbBedrockSemanticSearchStack/Network/VPC/SQSEndpoint/SecurityGroup/Resource',
        '/MongodbBedrockSemanticSearchStack/Network/MongoDBAtlasEndpointSecurityGroup/Resource',
      ],
      [
        {
          id: 'CdkNagValidationFailure',
          reason: 'See https://github.com/cdklabs/cdk-nag/issues/817',
        },
      ],
    );
  }
}
