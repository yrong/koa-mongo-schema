/* eslint camelcase: 0 */
const common = require('api-schema-common')
const schema = require('api-schema-core')
const apiSchemaCache = require('api-schema-cache')
const search = require('api-schema-search')
const requestHandler = require('./requestHandler')
const config = require('config')

const needNotify = (params, ctx) => {
  if (ctx.headers[config.get('auth.tokenFieldName')] === config.get('auth.internalUsedToken')) { return false }
  if (params.procedure && params.procedure.ignoreNotification) { return false }
  let schema_obj = schema.getAncestorSchema(params.category)
  if (schema_obj && schema_obj.notification) { return true }
}

const addNotification = async (params, ctx) => {
  if (needNotify(params, ctx)) {
    let notification = { type: params.category, user: ctx[config.get('auth.userFieldName')], source: process.env['NODE_NAME'] }
    if (ctx.method === 'POST') {
      notification.action = 'CREATE'
      notification.new = params.fields
    } else if (ctx.method === 'PUT' || ctx.method === 'PATCH') {
      notification.action = 'UPDATE'
      notification.new = params.fields
      notification.old = params.fields_old
      notification.update = params.change
    } else if (ctx.method === 'DELETE') {
      notification.action = 'DELETE'
      notification.old = params.fields_old
    }
    let notification_subscriber = requestHandler.legacyFormat(params) ? params.data.notification : params.notification_subscriber
    if (notification_subscriber) {
      if (notification_subscriber.subscribe_user) {
        notification.subscribe_user = notification_subscriber.subscribe_user
        if (notification_subscriber.subscribe_role) {
          notification.subscribe_role = notification_subscriber.subscribe_role
        } else {
          notification.subscribe_role = []
        }
      } else {
        if (notification_subscriber.subscribe_role) {
          notification.subscribe_role = notification_subscriber.subscribe_role
          notification.subscribe_user = []
        }
      }
      if (notification_subscriber.additional) {
        notification.additional = notification_subscriber.additional
      }
    }
    await common.apiInvoker('POST', common.getServiceApiUrl('notifier'), '/api/notifications', '', notification)
  }
}

const updateCache = async (params, ctx) => {
  if (ctx.method === 'POST') {
    await apiSchemaCache.addItem(params.fields)
  } else if (ctx.method === 'PUT' || ctx.method === 'PATCH') {
    await apiSchemaCache.delItem(params.fields_old)
    await apiSchemaCache.addItem(params.fields)
  } else if (ctx.method === 'DELETE') {
    await apiSchemaCache.delItem(params.fields_old)
  }
}

const updateSearch = async (params, ctx) => {
  if (ctx.method === 'POST') {
    let schema_obj = schema.getAncestorSchema(params.category)
    if (schema_obj && schema_obj.search) {
      if (schema_obj.search.upsert) {
        await search.addOrUpdateItem(params.fields, false, true)
      } else {
        await search.addOrUpdateItem(params.fields, false, false)
      }
    }
  } else if (ctx.method === 'PUT' || ctx.method === 'PATCH') {
    await search.addOrUpdateItem(params.fields, true)
  }
  if (ctx.method === 'DELETE') {
    await search.deleteItem(params.fields_old)
  }
}

module.exports = { addNotification, updateCache, updateSearch, needNotify }
