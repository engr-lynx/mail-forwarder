# Mail Forwarder

This needs a valid `cdk.context.json` file. You can write it by hand using `lib/config.ts` as guide. OR if you prefer yaml files... Copy `cdk.context.sample.yaml` to `cdk.context.yaml`. Replace the field values in the latter. Run `npm run context`. This assumes you have `yq` installed.

## Useful commands

 * `npm run build`   compile typescript to js
 * `npm run watch`   watch for changes and compile
 * `npm run context` convert `cdk.context.yaml` to `cdk.context.json`
 * `cdk deploy`      deploy this stack to your default AWS account/region
 * `cdk diff`        compare deployed stack with current state
 * `cdk synth`       emits the synthesized CloudFormation template
