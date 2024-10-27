import {
  join,
} from 'path'
import {
  Construct,
} from 'constructs'
import {
  Stack,
  RemovalPolicy,
  Duration,
  CustomResource,
  aws_route53 as Route53,
  aws_ses as SES,
  aws_ses_actions as Actions,
  aws_s3 as S3,
  aws_lambda as Lambda,
  aws_lambda_nodejs as Nodejs,
  aws_logs as Logs,
  aws_iam as IAM,
  custom_resources as Resources,
} from 'aws-cdk-lib'
import {
  MailForwarderConfig,
} from './config'

interface KeyValue {
  [key: string]: string
}

export interface StaticSiteProps extends MailForwarderConfig {}

export class MailForwarder extends Construct {

  public readonly storage: S3.Bucket

  constructor(scope: Construct, id: string, props: StaticSiteProps) {
    super(scope, id)
    const zone: Route53.IHostedZone = Route53.HostedZone.fromLookup(this, 'Zone', {
      domainName: props.domain,
    })
    const expiration: Duration = Duration.days(1)
    const lifecycleRules: S3.LifecycleRule[] = [
      {
        expiration,
      },
    ]
    const bucket: S3.Bucket = new S3.Bucket(this, 'Bucket', {
      bucketName: props.bucket,
      removalPolicy: RemovalPolicy.DESTROY,
      lifecycleRules,
    })

    const objectKeyPrefix: string = props.prefix ?? ''
    const entry: string = join(__dirname, 'forward-mail', 'index.ts')
    const bundling: Nodejs.BundlingOptions = {
      format: Nodejs.OutputFormat.ESM,
      externalModules: [
        '@aws-sdk',
      ],
    }
    const environment: KeyValue = {
      DOMAIN: zone.zoneName,
      BUCKET_NAME: bucket.bucketName,
      KEY_PREFIX: objectKeyPrefix,
      FORWARD_MAPPING: JSON.stringify(props.forwardMapping),
    }
    const forwardMailFunction: Nodejs.NodejsFunction = new Nodejs.NodejsFunction(this, 'ForwardMailFunction', {
      entry,
      handler: 'handler',
      runtime: Lambda.Runtime.NODEJS_20_X,
      logRetention: Logs.RetentionDays.ONE_DAY,
      timeout: Duration.seconds(10),
      bundling,
      environment,
    })
    bucket.grantRead(forwardMailFunction)
    const policyStatement: IAM.PolicyStatement = new IAM.PolicyStatement({
      actions: [
        'ses:SendRawEmail',
      ],
      resources: [
        '*',
      ],
      effect: IAM.Effect.ALLOW,
    })
    forwardMailFunction.addToRolePolicy(policyStatement)

    // ToDo: remove EmailIdentity once out of sandbox
    new SES.EmailIdentity(this, 'EmailIdentity', {
      identity: SES.Identity.email(props.email),
    })
    new SES.EmailIdentity(this, 'DomainIdentity', {
      identity: SES.Identity.publicHostedZone(zone),
    })
    const receiptRuleSet: SES.ReceiptRuleSet = new SES.ReceiptRuleSet(this, 'ReceiptRuleSet')
    const scanEnabled: boolean = props.scan ?? true
    const s3Action: Actions.S3 = new Actions.S3({
      bucket,
      objectKeyPrefix,
    })
    const lambdaAction: Actions.Lambda = new Actions.Lambda({
      function: forwardMailFunction,
    })
    const recipients: string[] = Object.keys(props.forwardMapping)
    receiptRuleSet.addRule('ForwardRule', {
      scanEnabled,
      recipients,
      actions: [
        s3Action,
        lambdaAction,
      ],
    })
    const physicalId: string = `SetActiveReceiptRuleSet-${Stack.of(this).region}`
    const physicalResourceId: Resources.PhysicalResourceId = Resources.PhysicalResourceId.of(physicalId)
    const onUpdate: Resources.AwsSdkCall = {
      service: 'ses',
      action: 'SetActiveReceiptRuleSet',
      physicalResourceId,
      parameters: {
        RuleSetName: receiptRuleSet.receiptRuleSetName,
      },
    }
    const policy: Resources.AwsCustomResourcePolicy = Resources.AwsCustomResourcePolicy.fromSdkCalls({
      resources: Resources.AwsCustomResourcePolicy.ANY_RESOURCE,
    })
    const activateReceiptRuleSet: Resources.AwsCustomResource = new Resources.AwsCustomResource(this, 'ActivateReceiptRuleSet', {
      onUpdate,
      policy,
      logRetention: Logs.RetentionDays.ONE_DAY,
      timeout: Duration.minutes(5),
    })
    activateReceiptRuleSet.node.addDependency(receiptRuleSet)
    const codePath: string = join(__dirname, 'custom-resources', 'empty-bucket')
    const code: Lambda.Code = Lambda.Code.fromAsset(codePath)
    const onEventHandler: Lambda.Function = new Lambda.Function(this, 'EmptyBucketFunction', {
      code,
      handler: 'index.handler',
      runtime: Lambda.Runtime.PYTHON_3_12,
      logRetention: Logs.RetentionDays.ONE_DAY,
      timeout: Duration.minutes(5),
    })
    bucket.grantRead(onEventHandler)
    bucket.grantDelete(onEventHandler)
    const emptyBucketProvider: Resources.Provider = new Resources.Provider(this, 'EmptyBucketProvider', {
      onEventHandler,
    })
    const properties: KeyValue = {
      bucketName: bucket.bucketName,
    }
    new CustomResource(this, 'EmptyBucketResource', {
      serviceToken: emptyBucketProvider.serviceToken,
      properties,
    })
    const priority: number = props.priority ?? 10
    const hostName: string = `inbound-smtp.${Stack.of(this).region}.amazonaws.com`
    const values: Route53.MxRecordValue[] = [
      {
        hostName,
        priority,
      },
    ]
    new Route53.MxRecord(this, 'MxRecord', {
      zone,
      values,
      recordName: zone.zoneName,
    })
  }

}
