import { type ISecret, Secret } from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';

interface SecretsConstructProps {
  /**
   * Name of the secret that contains the MongoDB Atlas connection string
   */
  mongoDBConnectionStringSecretName: string;
}

/**
 * Construct that imports a reference to the secret that contains the MongoDB Atlas connection string
 *
 * @note - you must create the secret manually in Secrets Manager before deploying the stack
 */
export class SecretsConstruct extends Construct {
  /**
   * Reference to the secret that contains the MongoDB Atlas connection string
   */
  public mongoDBConnectionStringSecret: ISecret;

  public constructor(
    scope: Construct,
    id: string,
    props: SecretsConstructProps,
  ) {
    super(scope, id);

    const { mongoDBConnectionStringSecretName } = props;

    // Secret that contains the MongoDB Atlas connection string
    this.mongoDBConnectionStringSecret = Secret.fromSecretNameV2(
      this,
      'ImportedSecret',
      mongoDBConnectionStringSecretName,
    );
  }
}
