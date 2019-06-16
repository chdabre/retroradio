const os = require('os')
const fs = require('fs')
const path = require('path')
const SpotifyWebApi = require('spotify-web-api-node')
const express = require('express')
const api = express()
const http = require('http').Server(api)
const io = require('socket.io')(http)

const RadioRemote = require('./serial')
let authSettings = require('./auth.json')
let channels = require('./channels.json')
let secrets = require('./secrets.json')

const PORT = process.env.PORT || 3000
const DEVICE_NAME = process.env.DEVICE_NAME || 'RetroRadio'
const remote = new RadioRemote(process.env.SERIAL_PORT || '/dev/tty.wchusbserial142240')
let deviceId = null

let state = {
  authState: 'unauthorized',
  channels,
  channelInfo: []
}

const scopes = ['user-read-playback-state', 'user-modify-playback-state']
const spotifyState = 'authorize'
const redirectUri = `http://${os.hostname()}:${PORT}/callback`

const spotify = new SpotifyWebApi({
  clientId: secrets.clientId,
  clientSecret: secrets.clientSecret,
  redirectUri
})

api.get('/authorize', function (req, res) {
  const authorizeURL = spotify.createAuthorizeURL(scopes, spotifyState)
  res.redirect(authorizeURL)
})

api.get('/callback', function (req, res) {
  authorize(authSettings, req.query.code)

  res.redirect('/')
})

if (process.env.NODE_ENV === 'production') {
  // Production mode
  // Static Files
  api.use(express.static(path.join(__dirname, './frontend/dist')))

  // Index view
  api.get('/', (req, res) => {
    res.sendfile(path.join(__dirname, './frontend/dist/index.html'))
  })
} else {
  // Development mode
  api.get('/', (req, res) => {
    res.redirect('http://localhost:8080')
  })
}

http.listen(PORT, () => {
  authorize(authSettings).then(data => {
    findDevice()
    updateChannelInfo()

    setInterval(() => {
      if (deviceId) updatePlaybackState().catch(err => console.error(err))
      findDevice()
    }, 10000)
    console.log(`Spotify backend listening on http://${os.hostname()}.local:${PORT}`)
  })
})

/* SOCKET.IO HANDLER */
io.on('connection', socket => {
  console.log('[connect] Socket Connected!')

  socket.on('init', (msg) => {
    try {
      console.log(`[init] Client ready`)
      updatePlaybackState().then(() => {
        socket.emit('state', state)
      })
    } catch (e) {
      socket.emit('err', {
        errorType: e.name,
        errorText: `Error in [init]: ${e.toString()}`
      })
      console.error(`Error in [init]: ${e.toString()}`)
    }
  })

  socket.on('disconnect', () => {
    try {
      console.log(`[disconnect] Socket has disconnected`)
    } catch (e) {
      socket.emit('err', {
        errorType: e.name,
        errorText: `Error in [disconnect]: ${e.toString()}`
      })
      console.error(`Error in [disconnect]: ${e.toString()}`)
    }
  })
})

remote.on('volume', event => {
  updatePlaybackState().then(data => {
    let playbackState = data.body
    if (typeof playbackState.device !== 'undefined') {
      if (playbackState.device.id === deviceId) {
        let volumePercent = playbackState.device.volume_percent
        let newVolumePercent = volumePercent + event.amount
        if (newVolumePercent > 100) newVolumePercent = 100
        if (newVolumePercent < 0) newVolumePercent = 0

        spotify.setVolume(newVolumePercent, {}).then(data => {}, err => console.error(`Error in [volume]: ${err}`))
      } else {
        remote.error()
      }
    }
  }, err => {
    console.error(`Error in [volume]: ${err}`)
  })
})

remote.on('volume-pressed', event => {
  if (deviceId) {
    updatePlaybackState().then(data => {
      let playbackState = data.body
      let isPlaying = playbackState.is_playing

      if (isPlaying) {
        spotify.pause().then(data => {}, err => console.error(`Error in [volume-pressed]: ${err}`))
      } else {
        spotify.setShuffle({ state: true }).then(data => {
          spotify.transferMyPlayback({
            deviceIds: [deviceId],
            play: true
          }).then(data => {
            updatePlaybackState().catch(err => console.error(err))
          }).catch(err => {
            if (err.statusCode === 404) {
              remote.error()
            }
          })
        }, err => {
          console.error(`Error in [volume-pressed]: ${err}`)
        })
      }
    }, err => {
      console.error(`Error in [volume-pressed]: ${err}`)
    })
  } else {
    remote.error()
  }
})

remote.on('select-channel', event => {
  if (deviceId) {
    spotify.transferMyPlayback({
      deviceIds: [deviceId],
      play: false
    }).then(data => {
      return spotify.play({
        context_uri: state.channels[event.channel]
      })
    }).then(data => {
      return spotify.setShuffle({
        state: true
      })
    }).catch(err => {
      if (err.statusCode === 404) remote.error()
    })
  } else {
    remote.error()
  }
})

function findDevice () {
  spotify.getMyDevices().then(data => {
    let devices = data.body.devices
    let found = false
    devices.forEach(device => {
      if (device.name === DEVICE_NAME) {
        found = true
        deviceId = device.id
      }
    })
    if (!found) {
      remote.sendCommand(1, 15)
      deviceId = null
    }
  }, err => console.error(err))
}

function updatePlaybackState () {
  return new Promise((resolve, reject) => {
    spotify.getMyCurrentPlaybackState({}).then(data => {
      state.playbackState = data.body
      if (state.playbackState.context) {
        let contextURI = state.playbackState.context.uri.split(':')
        let compareURI = contextURI.slice(Math.max(contextURI.length - 3, 0)).join(':')

        if (state.playbackState.device.id === deviceId) {
          let channelId = state.channels.indexOf(compareURI)
          if (channelId > -1) {
            remote.sendCommand(1, channelId)
          } else {
            remote.sendCommand(1, 15)
          }
        } else {
          remote.sendCommand(1, 15)
        }
      }
      io.emit('state', state)
      resolve(data)
    }, err => {
      console.error(`Error in [updatePlaybackState]: ${err}`)
      reject(err)
    })
  })
}

function updateChannelInfo () {
  for (let i = 0; i < state.channels.length; i++) {
    let channelUri = state.channels[i]
    getResourceInfo(channelUri).then(data => {
      state.channelInfo[i] = data.body
      io.emit('state', state)
    }, err => {
      state.channelInfo[i] = 'error'
      console.error(err)
    })
  }
}

function getResourceInfo (spotifyURI) {
  const resourceType = spotifyURI.split(':')[1]
  const objectId = spotifyURI.split(':')[2]

  if (resourceType === 'track') {
    return spotify.getTrack(objectId, {})
  } else if (resourceType === 'album') {
    return spotify.getAlbum(objectId, {})
  } else if (resourceType === 'playlist') {
    return spotify.getPlaylist(objectId, {})
  }
}

function authorize (authSettings, authCode) {
  return new Promise((resolve, reject) => {
    if (authCode) {
      spotify.authorizationCodeGrant(authCode).then(
        data => {
          console.log('[authorize] The token expires in ' + data.body['expires_in'])
          console.log('[authorize] The access token is ' + data.body['access_token'])
          console.log('[authorize] The refresh token is ' + data.body['refresh_token'])

          // Set the access token on the API object to use it in later calls
          spotify.setAccessToken(data.body['access_token'])
          spotify.setRefreshToken(data.body['refresh_token'])

          authSettings.accessToken = data.body['access_token']
          authSettings.refreshToken = data.body['refresh_token']
          authSettings.tokenExpiresOn = new Date(Date.now() + parseInt(data.body['expires_in'] * 1000)).toUTCString()
          storeSettings(authSettings)

          state.authState = 'authorized'
          io.emit('state', state)
          resolve(state.authState)
        },
        err => {
          console.error('[authorize] Something went wrong while trying to get an access token!', err)
          state.authState = 'unauthorized'
          io.emit('state', state)
          reject(err)
        }
      )
    } else if (authSettings.accessToken) {
      let tokenExpiresOn = new Date(Date.parse(authSettings.tokenExpiresOn))
      if (Date.now() < tokenExpiresOn) {
        console.log(`[authorize] Token ${authSettings.accessToken} expires on ${tokenExpiresOn.toLocaleString()}`)
        spotify.setAccessToken(authSettings.accessToken)
        state.authState = 'authorized'
        io.emit('state', state)
        resolve(state.authState)
      } else {
        console.log(`[authorize] Token ${authSettings.accessToken} expired on ${tokenExpiresOn.toLocaleString()}, refreshing...`)
        refreshToken(authSettings).then(data => {
          resolve(data)
        }).catch(err => {
          reject(err)
        })
      }
    } else {
      state.authState = 'unauthorized'
      io.emit('state', state)
      resolve(state.authState)
      console.log('[authorize] No auth Code available!')
      console.log(`Authorize at http://${os.hostname()}:${PORT}/authorize`)
    }
  })
}

function refreshToken (authSettings) {
  return new Promise((resolve, reject) => {
    spotify.setRefreshToken(authSettings.refreshToken)
    spotify.refreshAccessToken().then(
      data => {
        console.log('[refreshToken] The access token has been refreshed!')

        spotify.setAccessToken(data.body['access_token'])
        authSettings.accessToken = data.body['access_token']
        authSettings.tokenExpiresOn = new Date(Date.now() + parseInt(data.body['expires_in'] * 1000)).toUTCString()
        storeSettings(authSettings)
        state.authState = 'authorized'
        io.emit('state', state)
        resolve(state.authState)
      },
      err => {
        state.authState = 'unauthorized'
        console.error('[refreshToken] Could not refresh access token', err)
        reject(err)
      }
    )
  })
}

function storeSettings (authSettings) {
  let storeSettings = JSON.stringify(authSettings)
  if (typeof storeSettings !== 'undefined') {
    fs.writeFileSync(path.join(__dirname, './auth.json'), storeSettings)
  } else {
    console.error('[storeSettings] Error while trying to save auth settings', authSettings)
  }
}
