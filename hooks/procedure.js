const chalk = require('chalk')
const log4js = require('log4js-wrapper-advanced')
const logger = log4js.getLogger()

class Hook {
  constructor (functions,
    procedureName, hookName, timeout) {
    this.timeout = timeout
    this.name = hookName
    this.procedureName = procedureName
    if (!Array.isArray(functions)) {
      if (typeof functions === 'function' || functions instanceof Procedure) { functions = [functions] } else { throw new Error('hook should be function or array of functions') }
    }
    this.phases = []
    this.context = {}
    for (let func of functions) {
      if (func instanceof Procedure) { func = createProcedure(func) } else if (typeof func !== 'function') {
        throw new Error(`element ${func} passed as ${this.procedureName} lifecycle ` +
          'is neither a \'function\' nor a \'procedure\'')
      }
      this.phases.push(this.asyncify(func))
    }

    this.execute = (...args) => {
      let next = Promise.resolve(this.phases[0](...args))
      const rest = args.slice(1)
      for (let i = 1; i < this.phases.length; i++) {
        next = Promise.all([this.phases[i], next, rest])
          .then(([phase, response, rest]) => phase(response, ...rest))
      }
      return next
    }
  }

  asyncify (func) {
    return (...args) => Promise.race([
      Promise.resolve(func.apply(this.context, args))
        .then(response => {
          if (Array.isArray(response)) { return Promise.all(response) }
          return response
        }),
      new Promise((resolve, reject) => setTimeout(() => reject(
        new Error(`operation timed out, no response after ${this.timeout / 1000} seconds`)
      ), this.timeout))
    ])
      .catch((error) => {
        const complementary = `, in ${this.name} lifecycle of '${this.procedureName}'`
        if (typeof error === 'string') { error += complementary } else { error.message += complementary }
        throw error
      })
  }
}

class Procedure {
  constructor ({
    timeout = 4000, check = (params, user) => true,
    preProcess = params => params, postProcess = result => result, postServe = result => result,
    name = 'procedure', route, dbProcess = (params, ctx) => {}
  } = {}) {
    this.timeout = timeout
    this.check = check
    this.preProcess = preProcess
    this.postProcess = postProcess
    this.postServe = postServe
    this.name = route || name
    this.dbProcess = dbProcess
    this.beginTransaction = async (ctx) => {
      logger.trace(chalk.green('global transaction start!'))
      ctx.session = await ctx.mongo.startSession()
      await ctx.session.startTransaction()
    }
    this.endTransaction = async (error, params, ctx) => {
      if (error) {
        logger.error(chalk.red('global transaction rollback!'))
        await ctx.session.abortTransaction()
      } else {
        logger.trace(chalk.green('global transaction commit!'))
        await ctx.session.commitTransaction()
      }
      await ctx.session.endSession()
    }
  }

  getMiddleware (ctx) {
    const checkHook = new Hook(this.check,
      this.name, 'check', this.timeout)

    const preProcessHook = new Hook(this.preProcess,
      this.name, 'preProcess', this.timeout)

    const executionHook = new Hook(this.dbProcess, this.name, 'execution', this.timeout)

    const postProcessHook = new Hook(this.postProcess,
      this.name, 'postProcess', this.timeout)

    const postServeHook = new Hook(this.postServe,
      this.name, 'postServe', this.timeout * 3)

    return (params, ctx) => {
      const response = checkHook.execute(params, ctx)
        .then(checkPassed => {
          if (!checkPassed) { throw new Error(`Check lifecycle hook of ${this.name} did not pass`) }
          return [params, ctx]
        })
        .then(([params, ctx]) => Promise.all([
          params,
          ctx,
          this.beginTransaction(ctx)
        ]))
        .then(([params, ctx]) => Promise.all([
          preProcessHook.execute(params, ctx),
          ctx
        ]))
        .then(([params, ctx]) => Promise.all([
          executionHook.execute(params, ctx),
          params,
          ctx
        ]))
        .then(([result, params, ctx]) => Promise.all([
          postProcessHook.execute(result, params, ctx),
          params,
          ctx
        ]))
        .then(([result, params, ctx]) => Promise.all([
          result,
          params,
          ctx,
          this.endTransaction(null, params, ctx)
        ]))
      response
        .then(([result, params, ctx]) => {
          return postServeHook.execute(result, params, ctx)
        })
        .catch((error) => Promise.all([
          this.endTransaction(error, params, ctx)]
        ))
      return response.then(([result, params, ctx]) => result)
    }
  }
}

const createProcedure = (options) =>
  (new Procedure(options)).getMiddleware()

module.exports = { Procedure, createProcedure }
