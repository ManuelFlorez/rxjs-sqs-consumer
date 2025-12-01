import { vi } from "vitest";

// Mock global para send de SQS
export const sendMock = vi.fn();

// Opcional: si tu Manager usa más de un método, puedes simularlo así
export const MockSQSClient = vi.fn(() => ({
  send: sendMock,
}));

// Ejemplo de cómo exportar vi.fn() para otros métodos
export const receiveMessageMock = vi.fn();
export const deleteMessageMock = vi.fn();
