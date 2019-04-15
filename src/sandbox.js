const path = require('path')
const log = require('util').debuglog('caviar')
const {isString, isObject} = require('core-util-is')
const spawn = require('cross-spawn')

const {createError} = require('./error')
const {Lifecycle} = require('./lifecycle')

const error = createError('SANDBOX')

const ESSENTIAL_ENV_KEYS = [
  // For util.debug
  'NODE_DEBUG',
  // For userland debug module
  'DEBUG',
  // For global installed npm packages
  'NODE_PATH',
  // For `child_process.spawn`ers
  'PATH'
]

// Private env keys used by roe,
// which should not be changed by env plugins
const PRIVATE_ENV_KEYS = [
  'CAVIAR_CWD',
  'CAVIAR_DEV'
]

const createInheritEnv = host => key => {
  if (PRIVATE_ENV_KEYS.includes(key)) {
    throw error('PRESERVED_ENV_KEY', key)
  }

  const variable = process.env[key]
  if (variable) {
    host[key] = variable
  }
}

const ensureEnv = host => {
  const inheritEnv = createInheritEnv(host)
  ESSENTIAL_ENV_KEYS.forEach(inheritEnv)
}

// Sanitize and inject new environment variables into
// the child process
module.exports = class Sandbox {
  constructor (options) {
    if (!isObject(options)) {
      throw error('INVALID_OPTIONS', options)
    }

    const {
      serverClassPath = path.join(__dirname, 'server.js'),
      configLoaderClassPath = path.join(__dirname, 'config-loader.js'),
      cwd,
      dev,
      port
    } = options

    if (!isString(serverClassPath)) {
      throw error('INVALID_SERVER_PATH', serverClassPath)
    }

    if (!isString(configLoaderClassPath)) {
      throw error('INVALID_LOADER_PATH', configLoaderClassPath)
    }

    if (!isString(cwd)) {
      throw error('INVALID_CWD', cwd)
    }

    this._options = {
      serverClassPath,
      configLoaderClassPath,
      cwd,
      dev,
      port
    }

    this._configLoader = new this.ConfigLoader({
      cwd
    })
  }

  get spawner () {
    return path.join(__dirname, '..', 'spawner', 'start.js')
  }

  get ConfigLoader () {
    return require(this._options.configLoaderClassPath)
  }

  // ## Usage
  // ```js
  // const env = new Env({
  //   cwd,
  //   env: envConverter
  // })

  // const child = await env.spawn(command, args)
  // child.on('')
  // ```
  spawn (command, args, options = {}) {
    if (!options.stdio) {
      options.stdio = 'inherit'
    }

    options.env = {
      ...this._env,
      CAVIAR_CWD: this._cwd
    }

    if (this._dev) {
      options.env.CAVIAR_DEV = true
    }

    ensureEnv(options.env)

    const lifecycle = new Lifecycle({
      sandbox: true,
      configLoader: this._configLoader
    })

    lifecycle.applyPlugins()

    const sandbox = {
      inheritEnv: createInheritEnv(options.env)
    }

    // Apply sandbox env plugins
    lifecycle.hooks.sandboxEnvironment.call(sandbox)

    log('spawn: %s %j', command, args)

    const child = spawn(command, args, options)
    child.on('error', err => {
      log('child process errored: %s', err.stack)
    })

    // TODO
    // handle exit signal
    return child
  }

  async start () {
    const command = 'node'

    // TODO: child process events
    await this.spawn(
      command, [
        this.spawner,
        JSON.stringify(this._options)
      ]
    )
  }
}
