#!/usr/bin/env node
import 'source-map-support/register'
import {
  App,
} from 'aws-cdk-lib'
import {
  AppConfig,
} from '../lib/config'
import {
  BackEndStack,
} from '../lib/back-end-stack'

// ToDo: Use CDK nag (https://www.npmjs.com/package/cdk-nag).
const app = new App()
const appContext = app.node.tryGetContext('app')
const appConfig = appContext as AppConfig
const env = {
  region: process.env.CDK_DEFAULT_REGION,
  account: process.env.CDK_DEFAULT_ACCOUNT,
}
new BackEndStack(app, appConfig.name, {
  ...appConfig.backend,
  env,
})
