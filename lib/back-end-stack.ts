import {
  Construct,
} from 'constructs'
import {
  Stack,
  StackProps,
} from 'aws-cdk-lib'
import {
  MailForwarder,
} from './mail-forwarder'
import {
  BackEndConfig,
} from './config'

export interface BackEndProps extends StackProps, BackEndConfig {}

export class BackEndStack extends Stack {
  constructor(scope: Construct, id: string, props: BackEndProps) {
    super(scope, id, props)
    new MailForwarder(this, 'MailForwarder', {
      ...props.mailForwarder,
    })
  }
}
