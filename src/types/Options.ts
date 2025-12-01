import { Message } from '@aws-sdk/client-sqs'
import { SQSClientConfig } from '@aws-sdk/client-sqs'

export default interface Options {
  queueUrl: string
  handler: (msg: Message) => Promise<void>
  config: SQSClientConfig
  MaxNumberOfMessages?: number
  WaitTimeSeconds?: number
  VisibilityTimeout?: number
  heartbeatInterval?: number
  timeoutTemporaryError?: number
  onErrorReceivingMessage?: (error: Error) => Promise<void>
  onErrorVisibilityTimeout?: (msg: Message, error: Error) => Promise<void> 
  onErrorProccessMessage?: (msg: Message, error: Error) => Promise<void>
  onErrorConfiguration?: (error: Error) => Promise<void>
  onErrorTemporary?: (error: Error) => Promise<void>
}
