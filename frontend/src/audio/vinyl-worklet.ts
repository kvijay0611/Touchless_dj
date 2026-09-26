declare const sampleRate: number

declare function registerProcessor(
  name: string,
  processor: any
): void

declare class AudioWorkletProcessor {
  readonly port: MessagePort
  constructor(options?: unknown)
}

class VinylDeckProcessor extends AudioWorkletProcessor {
  private left: Float32Array | null = null
  private right: Float32Array | null = null

  private sampleRateSource = 44100
  private position = 0
  private rate = 1
  private playing = false
  private initialized = false
  private reportCounter = 0

  constructor() {
    super()

    this.port.onmessage = (event) => {
      const data = event.data || {}

      if (data.type === 'load') {
        this.left = data.left
        this.right = data.right || data.left
        this.sampleRateSource = data.sampleRate || sampleRate

        this.position = 0
        this.rate = 1
        this.playing = false
        this.initialized = true

        this.port.postMessage({
          type: 'state',
          position: 0,
          playing: false,
          duration: this.duration()
        })
      }

      else if (data.type === 'transport') {
        this.playing = Boolean(data.playing)
      }

      else if (data.type === 'rate') {
        this.rate = Math.max(
          0.5,
          Math.min(1.5, Number(data.rate) || 1)
        )
      }

      else if (data.type === 'seek') {
        this.position = Math.max(
          0,
          Math.min(this.duration(), Number(data.position) || 0)
        )
      }

      else if (data.type === 'nudge') {
        this.position = Math.max(
          0,
          Math.min(
            this.duration(),
            this.position + Number(data.delta || 0)
          )
        )
      }

      else if (data.type === 'reset') {
        this.position = 0
        this.playing = false
      }
    }
  }

  private duration() {
    if (!this.left) return 0

    return this.left.length / this.sampleRateSource
  }

  private sample(
    channel: Float32Array,
    sourceIndex: number
  ) {
    const i0 = Math.floor(sourceIndex)
    const frac = sourceIndex - i0

    if (i0 < 0 || i0 >= channel.length) {
      return 0
    }

    const a = channel[i0] || 0
    const b =
      channel[Math.min(channel.length - 1, i0 + 1)] || 0

    return a + (b - a) * frac
  }

  process(
    _inputs: Float32Array[][],
    outputs: Float32Array[][]
  ) {
    const output = outputs[0]

    const leftOutput = output?.[0]
    const rightOutput = output?.[1] || output?.[0]

    if (!leftOutput || !rightOutput) {
      return true
    }

    leftOutput.fill(0)
    rightOutput.fill(0)

    if (
      !this.initialized ||
      !this.left ||
      !this.right ||
      !this.playing
    ) {
      return true
    }

    /*
     * position is stored in SECONDS.
     *
     * Convert seconds → source-buffer samples.
     */
    const sourceRate = this.sampleRateSource

    for (let i = 0; i < leftOutput.length; i++) {
      if (this.position >= this.duration()) {
        this.position = this.duration()
        this.playing = false
        break
      }

      const sourceIndex =
        this.position * sourceRate

      leftOutput[i] = this.sample(
        this.left,
        sourceIndex
      )

      rightOutput[i] = this.sample(
        this.right,
        sourceIndex
      )

      /*
       * Advance in seconds according to playback rate.
       */
      this.position +=
        this.rate / sampleRate
    }

    this.reportCounter++

    if (this.reportCounter >= 12) {
      this.reportCounter = 0

      this.port.postMessage({
        type: 'state',
        position: this.position,
        playing: this.playing,
        duration: this.duration()
      })
    }

    return true
  }
}

registerProcessor(
  'nulldeck-vinyl-deck',
  VinylDeckProcessor
)