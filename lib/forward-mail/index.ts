import {
  S3Client,
  GetObjectCommand
} from "@aws-sdk/client-s3"
import {
  SESClient,
  SendRawEmailCommand
} from "@aws-sdk/client-ses"

interface Data {
  event: any
  callback: (error?: Error | null, result?: any) => Data
  context: any
  config: Record<string, any>
  log: (message: any) => void
  ses: SESClient
  s3: S3Client
  email?: any
  recipients?: string[]
  originalRecipients?: string[]
  originalRecipient?: string
  emailData?: string
}

/**
 * Parses the SES event record provided for the `mail` and `recipients` data.
 */
export async function parseEvent(data: Data): Promise<Data> {
  if (data.event?.Records?.length !== 1 ||
      data.event.Records[0]?.eventSource !== 'aws:ses' ||
      data.event.Records[0]?.eventVersion !== '1.0') {
    data.log({
      message: "parseEvent() received invalid SES message:",
      level: "error",
      event: JSON.stringify(data.event),
    })
    throw new Error('Error: Received invalid SES message.')
  }

  data.email = data.event.Records[0].ses.mail
  data.recipients = data.event.Records[0].ses.receipt.recipients
  return data
}

/**
 * Transforms the original recipients to the desired forwarded destinations.
 */
export async function transformRecipients(data: Data): Promise<Data> {
  const newRecipients: string[] = []
  data.originalRecipients = data.recipients
  for (const origEmail of data.recipients || []) {
    const origEmailKey = origEmail.toLowerCase().replace(/\+.*?@/, '@')
    let forwardMapping: Record<string, string[]>
    try {
      forwardMapping = JSON.parse(process.env.FORWARD_MAPPING || '{}')
    } catch (error) {
      data.log({
        level: "error",
        message: "Failed to parse FORWARD_MAPPING environment variable",
        error,
      })
      throw new Error('Error: Invalid FORWARD_MAPPING configuration.')
    }
    if (origEmailKey in forwardMapping) {
      newRecipients.push(...forwardMapping[origEmailKey])
      data.originalRecipient = origEmail
    } else {
      let origEmailDomain: string | undefined
      let origEmailUser: string | undefined
      const pos = origEmailKey.lastIndexOf("@")
      if (pos === -1) {
        origEmailUser = origEmailKey
      } else {
        origEmailDomain = origEmailKey.slice(pos)
        origEmailUser = origEmailKey.slice(0, pos)
      }
      if (origEmailDomain && origEmailDomain in forwardMapping) {
        newRecipients.push(...forwardMapping[origEmailDomain])
        data.originalRecipient = origEmail
      } else if (origEmailUser && origEmailUser in forwardMapping) {
        newRecipients.push(...forwardMapping[origEmailUser])
        data.originalRecipient = origEmail
      } else if ("@" in forwardMapping) {
        newRecipients.push(...forwardMapping["@"])
        data.originalRecipient = origEmail
      }
    }
  }

  if (newRecipients.length === 0) {
    data.log({
      message: `Finishing process. No new recipients found for original destinations: ${data.originalRecipients?.join(", ")}`,
      level: "info",
    })
    return data.callback()
  }

  data.recipients = newRecipients
  return data
}

/**
 * Fetches the message data from S3.
 */
export async function fetchMessage(data: Data): Promise<Data> {
  const bucketName = process.env.BUCKET_NAME
  const keyPrefix = process.env.KEY_PREFIX
  data.log({
    level: "info",
    message: `Fetching email at s3://${bucketName}/${keyPrefix}${data.email?.messageId}`,
  })

  try {
    const command = new GetObjectCommand({
      Bucket: bucketName,
      Key: `${keyPrefix}${data.email?.messageId}`,
    })
    const response = await data.s3.send(command)
    data.emailData = await response.Body?.transformToString()
    return data
  } catch (err) {
    data.log({
      level: "error",
      message: "Error occurred while fetching message:",
      error: err,
      stack: (err as Error).stack,
    })
    throw new Error("Error: Failed to load message from S3.")
  }
}

/**
 * Processes the message data, making updates to recipients and other headers
 * before forwarding message.
 */
export async function processMessage(data: Data): Promise<Data> {
  const match = data.emailData?.match(/^((?:.+\r?\n)*)(\r?\n(?:.*\s+)*)/m)
  let header = match && match[1] ? match[1] : data.emailData
  const body = match && match[2] ? match[2] : ''

  if (!/^reply-to:[\t ]?/mi.test(header || '')) {
    const fromMatch = header?.match(/^from:[\t ]?(.*(?:\r?\n\s+.*)*\r?\n)/mi)
    const from = fromMatch && fromMatch[1] ? fromMatch[1] : ''
    if (from) {
      header = `${header}Reply-To: ${from}`
      data.log({
        level: "info",
        message: `Added Reply-To address of: ${from}`,
      })
    } else {
      data.log({
        level: "info",
        message: "Reply-To address not added because From address was not properly extracted.",
      })
    }
  }

  const fromEmail = `noreply@${process.env.DOMAIN}`
  header = header?.replace(
    /^from:[\t ]?(.*(?:\r?\n\s+.*)*)/mgi,
    (match, from) => `From: ${from.replace(/<(.*)>/, '').trim()} <${fromEmail}>`
  )

  if (data.config.toEmail) {
    header = header?.replace(/^to:[\t ]?(.*)/mgi, `To: ${data.config.toEmail}`)
  }

  header = header?.replace(/^return-path:[\t ]?(.*)\r?\n/mgi, '')
  header = header?.replace(/^sender:[\t ]?(.*)\r?\n/mgi, '')
  header = header?.replace(/^message-id:[\t ]?(.*)\r?\n/mgi, '')
  header = header?.replace(/^dkim-signature:[\t ]?.*\r?\n(\s+.*\r?\n)*/mgi, '')

  data.emailData = `${header}${body}`
  return data
}

/**
 * Send email using the SES sendRawEmail command.
 */
export async function sendMessage(data: Data): Promise<Data> {
  const params = {
    Destinations: data.recipients,
    Source: data.originalRecipient,
    RawMessage: {
      Data: Buffer.from(data.emailData || ''),
    },
  }
  data.log({
    level: "info",
    message: `sendMessage: Sending email via SES. Original recipients: ${data.originalRecipients?.join(", ")}.\
 Transformed recipients: ${data.recipients?.join(", ")}.`,
  })
  
  try {
    const command = new SendRawEmailCommand(params)
    const result = await data.ses.send(command)
    data.log({
      level: "info",
      message: "sendRawEmail() successful.",
      result,
    })
    return data
  } catch (err) {
    data.log({
      level: "error",
      message: "sendRawEmail() returned error.",
      error: err,
      stack: (err as Error).stack,
    })
    throw new Error('Error: Email sending failed.')
  }
}

interface Overrides {
  steps?: ((data: Data) => Promise<Data>)[]
  config?: Record<string, any>
  log?: (message: any) => void
  ses?: SESClient
  s3?: S3Client
}

/**
 * Handler function to be invoked by AWS Lambda with an inbound SES email as
 * the event.
 */
export async function handler(
  event: any,
  context: any,
  callback: (error?: Error | null, result?: any) => Data,
  overrides?: Overrides
): Promise<Data> {
  const steps = overrides?.steps ?? [
    parseEvent,
    transformRecipients,
    fetchMessage,
    processMessage,
    sendMessage,
  ]
  const data: Data = {
    event,
    callback,
    context,
    config: overrides?.config ?? {},
    log: overrides?.log ?? console.log,
    ses: overrides?.ses ?? new SESClient({}),
    s3: overrides?.s3 ?? new S3Client({}),
  }
  
  try {
    let result: Data = data
    for (const step of steps) {
      result = await step(result)
    }
    data.log({
      level: "info",
      message: "Process finished successfully.",
    })
    return data.callback()
  } catch (err) {
    data.log({
      level: "error",
      message: `Step returned error: ${(err as Error).message}`,
      error: err,
      stack: (err as Error).stack,
    })
    return data.callback(new Error("Error: Step returned error."))
  }
}
