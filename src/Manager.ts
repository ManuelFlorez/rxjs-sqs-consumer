import { Message, ReceiveMessageCommand, SQSClient, ChangeMessageVisibilityCommand, DeleteMessageCommand } from '@aws-sdk/client-sqs'
import Options from './types/Options'

export class Manager {
  private client: SQSClient
  private readonly queueUrl: string
  private readonly handler: (msg: Message) => Promise<void>
  private readonly MaxNumberOfMessages: number
  private readonly WaitTimeSeconds: number
  private readonly VisibilityTimeout: number
  private readonly heartbeatInterval: number
  private readonly timeoutTemporaryError: number
  private readonly onErrorReceivingMessage?: ((error: Error) => Promise<void>)
  private readonly onErrorVisibilityTimeout?: (msg: Message, error: Error) => Promise<void>
  private readonly onErrorProccessMessage?: (msg: Message, error: Error) => Promise<void>
  private readonly onErrorConfiguration?: (error: Error) => Promise<void>
  private readonly onErrorTemporary?: (error: Error) => Promise<void>

  private running = false
  private shutdownPromise: Promise<void> | null = null
  private resolveShutdown: (() => void) | null = null

  constructor({ queueUrl, handler, config, MaxNumberOfMessages, WaitTimeSeconds, VisibilityTimeout, heartbeatInterval, timeoutTemporaryError, onErrorReceivingMessage, onErrorVisibilityTimeout, onErrorProccessMessage, onErrorConfiguration, onErrorTemporary }: Options) {
    this.client = new SQSClient( config )
    this.queueUrl = queueUrl
    this.handler = handler
    this.MaxNumberOfMessages = MaxNumberOfMessages || 10
    this.WaitTimeSeconds = WaitTimeSeconds || 20
    this.VisibilityTimeout = VisibilityTimeout || 30
    this.heartbeatInterval = heartbeatInterval || (VisibilityTimeout ? Math.floor(VisibilityTimeout / 2) : 15)
    this.timeoutTemporaryError = timeoutTemporaryError || 5000
    if (onErrorReceivingMessage) 
      this.onErrorReceivingMessage = onErrorReceivingMessage
    if (onErrorVisibilityTimeout)
      this.onErrorVisibilityTimeout = onErrorVisibilityTimeout
    if (onErrorProccessMessage)
      this.onErrorProccessMessage = onErrorProccessMessage
    if (onErrorConfiguration)
      this.onErrorConfiguration = onErrorConfiguration
    if (onErrorTemporary)
      this.onErrorTemporary = onErrorTemporary
  }

  public start(): void {
    if (this.running) return
    this.running = true
    this.shutdownPromise = new Promise((resolve) => { this.resolveShutdown = resolve })
    void this.loop()
  }

  public async stop(): Promise<void> {
    if (!this.running)
      return

    this.running = false

    await this.shutdownPromise
  }

  private async loop() {
    while(this.running)
      await this.receiveMessage()
    
    if (this.resolveShutdown)
      this.resolveShutdown()
  }

  private async receiveMessage() {
    const command = new ReceiveMessageCommand({
      QueueUrl: this.queueUrl,
      MaxNumberOfMessages: this.MaxNumberOfMessages,
      WaitTimeSeconds: this.WaitTimeSeconds,
      VisibilityTimeout: this.VisibilityTimeout
    })

    try {
      const response = await this.client.send( command )

      const messages = response.Messages ?? []

      const proccessingPromises = messages.map(msg => this.processMessageWithVisibilityHeartbeat(msg))
    
      await Promise.allSettled(proccessingPromises)
    } catch (error: any) {
      this.onErrorReceivingMessage?.(error as Error)

      const isQueueNonExistent = 
        error.Code === 'AWS.SimpleQueueService.NonExistentQueue' || 
        error.__type === 'com.amazonaws.sqs#QueueDoesNotExist'
      
      const isInvalidCredentials = 
        error.Code === 'InvalidClientTokenId' ||
        error.__type === 'com.amazon.coral.service#UnrecognizedClientException'

      if (isQueueNonExistent || isInvalidCredentials) {
        this.onErrorConfiguration?.(error as Error)
        await this.stop()
        return
      }

      if (this.running) {
        this.onErrorTemporary?.(error)
        await new Promise(resolve => setTimeout(resolve, this.timeoutTemporaryError))
      }

    }
  }

  private async processMessageWithVisibilityHeartbeat(msg: Message): Promise<void> {
    if (!msg.ReceiptHandle) return

    let heartbeatTimer: NodeJS.Timeout | null = null

    const extendVisibility = async () => {
      if (!msg.ReceiptHandle)
        return

      try {
        const newVisibilityTimeout = this.VisibilityTimeout
        const changeVisibilityCommand = new ChangeMessageVisibilityCommand({
          QueueUrl: this.queueUrl,
          ReceiptHandle: msg.ReceiptHandle,
          VisibilityTimeout: newVisibilityTimeout,
        })
        await this.client.send(changeVisibilityCommand)
      } catch (error) {
        if (heartbeatTimer)
          clearInterval(heartbeatTimer)
        this.onErrorVisibilityTimeout?.(msg, error as Error)
      }
    }

    try {
      heartbeatTimer = setInterval(() => { void extendVisibility() }, this.heartbeatInterval * 1000)

      await this.handler(msg)

      await this.deleteMessage(msg.ReceiptHandle)
    } catch (error) {
      this.onErrorProccessMessage?.(msg, error as Error)
    } finally {
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer)
        heartbeatTimer = null
      }
    }
  }

  private async deleteMessage(receipHandler: string): Promise<void> {
    const command = new DeleteMessageCommand({
      QueueUrl: this.queueUrl,
      ReceiptHandle: receipHandler
    })
    await this.client.send(command)
  }
}
