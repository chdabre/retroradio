const EventEmitter = require('events')
const SerialPort = require('serialport')
const ByteLength = require('@serialport/parser-byte-length')

const COMMAND_SYSTEM_STATUS = 0
const COMMAND_VOLUME = 1
const COMMAND_CHANNEL_SELECT = 2

const STATUS_READY = 1

module.exports = class RadioRemote extends EventEmitter {
  constructor (path) {
    super()

    // Initialize Class Variables
    this.volumeTimeout = null
    this.volumeDelta = 0

    // Connect Serial Port
    if (path) {
      this.port = new SerialPort(path, { baudRate: 115200 })
      // Initialize Parser
      let parser = new ByteLength({ length: 2 })
      this.port.pipe(parser)

      parser.on('data', byte => {
        const id = byte >> 4
        const value = byte & 0x0F

        switch (id) {
          case COMMAND_SYSTEM_STATUS:
            // System Status
            break
          case COMMAND_VOLUME:
            if (value === 0) {
              this.emit('volume-pressed')
            } else {
              this.updateVolume(value === 1)
            }
            break
          case COMMAND_CHANNEL_SELECT:
            this.emit('select-channel', { channel: value })
            break
        }
      })

      setInterval(() => {
        this.sendCommand(COMMAND_SYSTEM_STATUS, STATUS_READY)
      }, 5000)
    }
  }

  sendCommand (command, value) {
    // console.log(`[remote] send Command ${command}, ${value}`)
    const message = Buffer.from([((command & 0x0F) << 4) | (value & 0x0F)])
    if (this.port) this.port.write(message)
  }

  error () {
    this.sendCommand(2, 0)
    this.sendCommand(1, 15)
  }

  updateVolume (direction) {
    this.volumeDelta += 5 * (direction ? 1 : -1)

    clearTimeout(this.volumeTimeout)
    this.volumeTimeout = setTimeout(() => {
      this.emit('volume', {
        amount: this.volumeDelta
      })
      this.volumeDelta = 0
    }, 500)
  }
}
