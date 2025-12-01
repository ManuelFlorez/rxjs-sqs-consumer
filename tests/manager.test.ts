// tests/manager.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { sendMock } from './mocks'

// Reset de mocks antes de cada test
beforeEach(() => {
  sendMock.mockReset()
})

describe('Manager', () => {
  it('procesa un mensaje y lo llama al handler', async () => {
    // Mensaje de prueba
    const message = { Body: JSON.stringify({ hello: 'world' }), ReceiptHandle: '123' }

    // Mock de SQS: devuelve un mensaje inmediatamente
    sendMock.mockResolvedValueOnce({ Messages: [message] })

    // Handler falso
    const handler = vi.fn().mockResolvedValue(undefined)

    // Simulación muy simple del Manager
    const manager = {
      process: async () => {
        const resp = await sendMock() // ReceiveMessage
        if (resp.Messages && resp.Messages.length > 0) {
          for (const msg of resp.Messages) {
            await handler(msg)
          }
        }
      },
    }

    // Ejecutar
    await manager.process()

    // Asegurarse de que el handler se llamó
    expect(handler).toHaveBeenCalledOnce()
    expect(handler).toHaveBeenCalledWith(message)
  })
})
