import {
  ReceiveMessageCommand,
  SQSClient,
  Message,
  DeleteMessageBatchCommand,
  ChangeMessageVisibilityCommand
} from '@aws-sdk/client-sqs'
import { finalize, from, mergeMap, Observable, retry, timer } from 'rxjs'

export class SQSManager {
  private readonly sqsClient: SQSClient
  private isListening = false

  private readonly deleteBuffer: { Id: string; ReceiptHandle: string }[] = []
  private readonly deleteInterval: NodeJS.Timeout | null = null

  constructor(
    private readonly queueUrl: string,
    private readonly region: string
  ) {
    this.sqsClient = new SQSClient({ region })

    // flush automático cada 5 segundos
    this.deleteInterval = setInterval(() => this.flushBatchDelete(), 5000)
  }

  /**
   * Crea un observable que hace long polling a SQS de manera continua.
   */
  listen(): Observable<Message> {
    return new Observable<Message>(subscriber => {
      this.isListening = true

      const poll = async () => {
        while (this.isListening && !subscriber.closed) {
          try {
            const command = new ReceiveMessageCommand({
              QueueUrl: this.queueUrl,
              WaitTimeSeconds: 20,
              MaxNumberOfMessages: 10,
              AttributeNames: ['All']
            })

            const { Messages } = await this.sqsClient.send(command)
            
            if (Messages?.length) {
              for (const msg of Messages) {
                if (!subscriber.closed) subscriber.next(msg)
              }
            }
          } catch (err) {
            subscriber.error(err)
            this.isListening = false
            return
          }
        } 
      }

      poll()

      return () => {
        this.isListening = false
        console.log('🛑 Deteniendo escucha de SQS.')

        if (this.deleteInterval) clearInterval(this.deleteInterval)
        this.flushBatchDelete()
      }
    })
  }

  /**
   * Agrega un mensaje al buffer y hace flush cuando hay suficientes
   */
  private async addToDeleteBatch(message: Message) {
    if (!message.MessageId || !message.ReceiptHandle) return

    this.deleteBuffer.push({
      Id: message.MessageId,
      ReceiptHandle: message.ReceiptHandle
    })

    // Cuando llegamos a 10 → flush inmediato (máximo permitido por AWS)
    if (this.deleteBuffer.length >= 10) {
      await this.flushBatchDelete()
    }
  }

  /**
   * Envia los deletes a SQS en batch
   */
  private async flushBatchDelete() {
    if (this.deleteBuffer.length === 0) return

    const batch = this.deleteBuffer.splice(0, 10)

    try {
      console.log(`📦 Eliminando batch de ${batch.length} mensajes`)
      await this.sqsClient.send(
        new DeleteMessageBatchCommand({
          QueueUrl: this.queueUrl,
          Entries: batch
        })
      )
    } catch (err) {
      console.error('❌ Error en DeleteMessageBatch', err)

      // reinsertar los mensajes fallados al buffer
      this.deleteBuffer.unshift(...batch)
    }
  }
  
  /** ------------------------- HANDLER / RETRY / BACKOFF / JITTER ------------------------- */
  /**
   * Procesa cada mensaje con retry + backoff exponencial
   *  - retry (max 5)
   *  - exponential backoff
   *  - jitter
   *  - batch delete
   *  - concurrency configurable
   * @param handler Función async que procesa el mensaje
   */
  processMessage(
    handler: (msg: Message) => Promise<any>,
    concurrency: number = 10,
    maxRetries: number = 5,
    baseDelay: number = 1000,
    visibilityTimeout: number = 30,
    visibilityInterval: number = 15000
  ) {
    return this.listen().pipe(
      mergeMap(
        message =>
          new Observable(subscriber => {
            // Inicia heartbeat de visibilidad
            const visibilityExtender = this.startVisibilityExtender(
              message,
              visibilityTimeout,
              visibilityInterval
            )

            from(handler(message))
              .pipe(
                retry({
                  count: maxRetries,
                  delay: (_error, retryCount) => {
                    const backoff = baseDelay * Math.pow(2, retryCount)
                    const jitter = Math.floor(Math.random() * backoff)
                    return timer(jitter)
                  }
                }),
                finalize(async () => {
                  // Detener extender
                  this.stopVisibilityExtender(visibilityExtender)

                  // Agregar al batch delete
                  await this.addToDeleteBatch(message)
                })
              )
              .subscribe({
                next: v => subscriber.next(v),
                error: e => subscriber.error(e),
                complete: () => subscriber.complete()
              })
          }),
          concurrency
      )
    )
  }

  /** ------------------------- VISIBILITY EXTENDER ------------------------- */
  private startVisibilityExtender(
    message: Message,
    timeoutSec: number,
    intervalMs: number
  ): NodeJS.Timeout | null {
    if (!message.ReceiptHandle) return null
  
    const extender = setInterval(async () => {
      try {
        await this.sqsClient.send(
          new ChangeMessageVisibilityCommand({
            QueueUrl: this.queueUrl,
            ReceiptHandle: message.ReceiptHandle,
            VisibilityTimeout: timeoutSec
          })
        )
        console.log(`⏳ Extendido VisibilityTimeout para ${message.MessageId}`)
      } catch (err) {
        console.error(`❌ Error extendiendo VisibilityTimeout para ${message.MessageId}`,err)
      }
    }, intervalMs)

    return extender
  }

  private stopVisibilityExtender(timer: NodeJS.Timeout | null) {
    if (timer) clearInterval(timer)
  }

}
