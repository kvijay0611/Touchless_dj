class VinylDeckProcessor extends AudioWorkletProcessor {
    left = null
    right = null
  
    sampleRateSource = 44100
    position = 0
    rate = 1
    playing = false
    initialized = false
    reportCounter = 0
  
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
  
    duration() {
      if (!this.left) return 0
  
      return this.left.length / this.sampleRateSource
    }
  
    sample(
      channel,
      sourceIndex
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
      _inputs,
      outputs
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
  