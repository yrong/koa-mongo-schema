/* eslint camelcase: 0 */
const _ = require('lodash')
const jp = require('jsonpath')
const config = require('config')
const uuid = require('uuid')
const schema = require('scirichon-json-schema')
const common = require('scirichon-common')
const ScirichonError = common.ScirichonError
const scirichon_cache = require('scirichon-cache')

const getCategoryByUrl = function (ctx) {
  let category; let val; let routeSchemas = schema.getApiRouteSchemas()
  for (val of routeSchemas) {
    if (ctx.path === val.route) {
      category = val.id
      break
    }
  }
  if (!category) {
    for (val of routeSchemas) {
      if (ctx.path.includes(val.route)) {
        category = val.id
        break
      }
    }
  }
  if (!category) {
    throw new ScirichonError(`can not find category for ${ctx.path}`)
  }
  return category
}

const getIndexByCategory = (category) => {
  let schema_obj = schema.getAncestorSchema(category); let index
  if (schema_obj && schema_obj.search && schema_obj.search.index) {
    index = schema_obj.search.index
  }
  return index
}

const getCollectionByCategory = (category) => {
  let schema_obj = schema.getAncestorSchema(category)
  return schema_obj && schema_obj.collection
}

const assignFields4Query = async function (params, ctx) {
  params.category = params.category || getCategoryByUrl(ctx)
  params.sort = params.sort || { lastUpdated: -1 }
  if (params.page) {
    params.pagination = true
    params.limit = params.per_page = parseInt(params.per_page || config.get('perPageSize'))
    params.skip = (parseInt(params.page) - 1) * parseInt(params.per_page)
  }
  return params
}

const checkReferenceObj = async (key, value) => {
  let cached_val = await scirichon_cache.getItemByCategoryAndID(key, value)
  if (!cached_val || !cached_val.uuid) {
    throw new ScirichonError(`不存在引用类型为${key},id为${value}的节点`)
  }
  return cached_val
}

const checkReferenceAndSetNameField = async (params) => {
  let refs = schema.getSchemaRefProperties(params.category); let key; let path; let key_name; let vals; let val; let category; let ref_obj; let ref_names
  if (refs) {
    for (let ref of refs) {
      key = ref.attr
      path = `$.${key}`
      vals = jp.query(params.fields, path)
      key_name = _.replace(key, /\./g, '_') + '_name'
      category = ref.schema || (ref.items && ref.items.schema)
      if (vals && vals.length) {
        if (ref.type === 'array' && ref.item_type) {
          vals = _.isArray(vals[0]) ? vals[0] : vals
          ref_names = []
          for (let val of vals) {
            if (_.isString(val)) {
              ref_obj = await checkReferenceObj(category, val)
              if (ref_obj && ref_obj.unique_name && config.get('addRefUniqueNameField')) {
                ref_names.push(ref_obj.unique_name)
              }
            }
          }
          if (ref_names.length) {
            params.fields[key_name] = ref_names
          }
        } else {
          val = vals[0]
          if (!_.isEmpty(val)) {
            ref_obj = await checkReferenceObj(category, val)
            if (ref_obj && ref_obj.unique_name && config.get('addRefUniqueNameField')) {
              params.fields[key_name] = ref_obj.unique_name
            }
          }
        }
      }
    }
  }
  return params
}

const generateUniqueNameFieldAndCompoundModel = async (params, ctx) => {
  let schema_obj = schema.getAncestorSchema(params.category); let compound_obj = _.assign({ category: params.category }, params.fields)
  if (schema_obj.uniqueKeys && schema_obj.uniqueKeys.length) {
    params.fields.unique_name = params.fields[schema_obj.uniqueKeys[0]]
  } else if (schema_obj.compoundKeys && schema_obj.compoundKeys.length) {
    if (params.fields['name']) {
      compound_obj['name'] = params.fields['name']
    }
    for (let key of schema_obj.compoundKeys) {
      if (key !== 'name') {
        let category = _.capitalize(key)
        let result = await scirichon_cache.getItemByCategoryAndID(category, params.fields[key])
        if (!_.isEmpty(result)) {
          key = key + '_name'
          compound_obj[key] = result.name
        }
      }
    }
    let keyNames = _.map(schema_obj.compoundKeys, (key) => key !== 'name' ? key + '_name' : key)
    params.fields.unique_name = compound_obj.unique_name = common.buildCompoundKey(keyNames, compound_obj)
  }
  return compound_obj
}

const checkUniqueField = async (params, ctx) => {
  if (params.procedure && params.procedure.ignoreUniqueCheck) {
  } else {
    if (params.fields.unique_name) {
      let obj = await scirichon_cache.getItemByCategoryAndUniqueName(params.category, params.fields.unique_name)
      if (!_.isEmpty(obj)) {
        throw new ScirichonError(`${params.category}存在名为"${params.fields.unique_name}"的同名对象`)
      }
    }
  }
}

const generateFieldsForCreate = async (params, ctx) => {
  params.fields = _.assign({}, params.data.fields)
  params.category = params.fields.category = params.data.category
  params.uuid = params.fields._id = params.fields.uuid = params.fields.uuid || uuid.v1()
  params.fields.created = params.fields.created || Date.now()
  params.fields.lastUpdated = params.fields.lastUpdated || Date.now()
  await generateUniqueNameFieldAndCompoundModel(params, ctx)
  await checkUniqueField(params, ctx)
}

const generateFieldsForUpdate = async (result, params, ctx) => {
  let lastUpdated = Date.now()
  params.change = _.assign({ lastUpdated }, params.data.fields)
  params.fields_old = result
  params.fields = _.assign({}, params.fields_old, params.change)
  await generateUniqueNameFieldAndCompoundModel(params, ctx)
}

const assignFields4Cud = async (params, ctx) => {
  // eslint-disable-next-line no-mixed-operators
  params.category = params.data && params.data.category || getCategoryByUrl(ctx)
  if (ctx.method === 'POST') {
    await generateFieldsForCreate(params, ctx)
    await checkReferenceAndSetNameField(params)
  } else if (ctx.method === 'PUT' || ctx.method === 'DELETE') {
    let result = await ctx.db.collection(getCollectionByCategory(params.category)).findOne({ uuid: params.uuid })
    if (result) {
      if (ctx.method === 'PUT') {
        await generateFieldsForUpdate(result, params, ctx)
        await checkReferenceAndSetNameField(params)
      } else if (ctx.method === 'DELETE') {
        params.fields_old = result
        if (ctx.url.includes('/api/items') && ctx.method === 'DELETE') {
          ctx.deleteAll = true
        }
      }
    } else {
      throw new ScirichonError('不存在该节点,操作失败')
    }
  }
}

const assignFields = async (params, ctx) => {
  if (ctx.method === 'POST' || ctx.method === 'PUT' || ctx.method === 'PATCH' || ctx.method === 'DELETE') {
    await assignFields4Cud(params, ctx)
  } else if (ctx.method === 'GET') {
    await assignFields4Query(params, ctx)
  }
}

const handleRequest = async (params, ctx) => {
  await assignFields(params, ctx)
  return params
}

module.exports = { getCategoryByUrl, handleRequest, getIndexByCategory, getCollectionByCategory, generateUniqueNameFieldAndCompoundModel,assignFields4Query }
