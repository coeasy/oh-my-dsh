/**
 * Bounded rolling character buffer with whitespace normalization.
 *
 * The detector works on normalized text so that trivial whitespace/linebreak
 * differences between repeated blocks do not defeat periodicity detection.
 * The buffer drops the oldest chars once it exceeds `windowChars`.
 */

/** Collapse runs of whitespace to a single space (keeps the semantic content). */
export function normalizeText(input: string): string {
  return input.replace(/\s+/g, ' ')
}

/** A bounded append-only text window that keeps a rolling tail. */
export class RollingBuffer {
  private text = ''
  private readonly capacity: number

  constructor(capacity: number) {
    if (!Number.isInteger(capacity) || capacity < 1)
      throw new Error('capacity must be a positive integer')
    this.capacity = capacity
  }

  /** Append normalized text; the buffer never exceeds capacity. */
  append(chunk: string): void {
    this.text += normalizeText(chunk)
    if (this.text.length > this.capacity) {
      this.text = this.text.slice(this.text.length - this.capacity)
    }
  }

  /** Full normalized content currently retained. */
  get content(): string {
    return this.text
  }

  get length(): number {
    return this.text.length
  }

  reset(): void {
    this.text = ''
  }
}
