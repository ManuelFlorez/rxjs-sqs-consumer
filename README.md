# 📦 SQS Message Manager

SQS Message Manager es una utilidad para Node.js que simplifica el consumo de mensajes desde Amazon SQS, gestionando:

- Recepción de mensajes (long polling)
- Heartbeat automático para extender el VisibilityTimeout
- Manejo de errores configurable
- Eliminación del mensaje tras su procesamiento
- Control de arranque/parada seguro

Ideal para workers o microservicios que procesan colas SQS de forma constante y resiliente.

## 🚀 Instalación

```bash
npm install @manuelflorezw/rxjs-sqs-consumer
```

## 🧠 ¿Qué es Manager?

__Manager__ es una clase que crea un consumidor robusto para una cola SQS.
Se encarga de:

- Ejecutar un loop continuo para recibir mensajes
- Invocar el __handler__ definido por el usuario
- Extender la visibilidad del mensaje mientras se procesa
- Gestionar errores temporales y permanentes
- Apagar el worker de forma segura cuando se solicita

## 📘 Uso básico

```typescript
import { Manager } from 'sqs-message-manager'

const manager = new Manager({
  queueUrl: 'https://sqs.eu-west-1.amazonaws.com/123456789012/mi-cola',
  handler: async (msg) => {
    console.log('Mensaje recibido:', msg)
    // Lógica de procesamiento...
  },
  config: { region: 'eu-west-1' }
})

manager.start()

// Para detenerlo (por ejemplo al recibir SIGTERM)
await manager.stop()
```

## ⚙️ Opciones disponibles

La clase recibe un objeto __Options__ con las siguientes propiedades:

Propiedad | Tipo | Requerido | Descripción
--------- | ---- | --------- | -----------
*queueUrl* | ```string``` | ✔ | URL completa de la cola SQS.
*handler* | ```(msg: Message) => Promise<void>``` | ✔ | Función que procesa cada mensaje recibido.
*config* | ```SQSClientConfig``` | ✔ | Configuración del cliente SQS (región, credenciales, etc.).
*MaxNumberOfMessages* | ```number``` | ✖ | Máx. mensajes por poll (default: 10).
*WaitTimeSeconds* | ```number``` | ✖ | Long polling en segundos (default: 20).
*VisibilityTimeout* | ```number``` | ✖ | Tiempo de visibilidad inicial por mensaje (default: 30).
*heartbeatInterval* | ```number``` | ✖ | Frecuencia en segundos para extender la visibilidad (default: mitad de *VisibilityTimeout*).
*timeoutTemporaryError* | ```number``` | ✖ | Tiempo de espera tras un error temporal (default: 5000ms).
*onErrorReceivingMessage* | ```(error) => Promise<void>``` | ✖ | Callback en errores al recibir mensajes.
*onErrorVisibilityTimeout* | ```(msg, error) => Promise<void>``` | ✖ | Callback cuando falla la extensión de visibilidad.
*onErrorProccessMessage* | ```(msg, error) => Promise<void>``` | ✖ | Callback cuando falla el procesamiento del mensaje.
*onErrorConfiguration* | ```(error) => Promise<void>``` | ✖ | Error crítico (cola inexistente, credenciales inválidas).
*onErrorTemporary* | ```(error) => Promise<void>``` | ✖ | Errores temporales que se reintentan.

## 🫀 Heartbeat (Extensión de visibilidad)

Mientras tu handler procesa un mensaje, el worker ejecuta un heartbeat cada __heartbeatInterval__ segundos que llama:

```typescript
ChangeMessageVisibility
```

Esto evita que SQS vuelva a entregar el mensaje mientras está siendo procesado.

## 🛑 Parada limpia

*manager.stop()* detiene el loop solo después de que los mensajes en proceso terminen.

```typescript
process.on('SIGTERM', async () => {
  console.log('Deteniendo worker...')
  await manager.stop()
  process.exit(0)
})
```

## 🧪 Ejemplo con manejo de errores

```typescript
const manager = new Manager({
  queueUrl,
  handler: async (msg) => {
    const body = JSON.parse(msg.Body!)
    if (!body.ok) throw new Error('Mensaje inválido')
    console.log('Procesado correctamente')
  },
  config: { region: 'eu-west-1' },

  onErrorProccessMessage: async (msg, err) => {
    console.error('Error procesando mensaje:', err);
  },

  onErrorVisibilityTimeout: async (msg, err) => {
    console.error('Error extendiendo VisibilityTimeout:', err);
  },

  onErrorTemporary: async (err) => {
    console.warn('Error temporal, reintentando...', err);
  }
})

manager.start()
```
