An easy to use framework to quick build rest api service from [json-schema](http://json-schema.org/) data models

## data modeling based on json schema extension attributes

```
{
  "id": "User",
  "type": "object",
  "properties": {
    "alias": {
      "type": "string"
    },
    "name": {
      "type": "string"
    },
    "lang": {
      "type": "string"
    },
    "userid":{
      "type":"integer"
    },
    "passwd":{
      "type":"string"
    }
  },
  "collection": "user"
  "route":"/users"
}
{
  "id": "ConfigurationItem",
  "type": "object",
  "properties": {
    "name": {
      "type": "string"
    },
    "responsibility":{
        "type": "string",
        "schema":"User"
    },
    "maintainers": {
          "type": "array",
          "items": { "type": "string", "schema":"User"},
          "uniqueItems": true
    },
    ...
  },
  "required": ["name"],
  "route": "/cfgItems",
  "collection": "cfgItem"
  "search":{"index":"cfgItem"}
}
```

* first each data model is a valid json schema, and can be validated with [ajv](https://github.com/epoberezkin/ajv)

* data model with attribute `"route":"/users"`  means restful api interface will be generated as following

```
POST /users

PUT  /users/:uuid

DELETE /users/:uuid

GET /users/:uuid

GET /users
```

* `"collection": "user"`  means instance will be stored into mongodb collection named `user`


* `"responsibility":{
           "type": "string",
           "schema":"User"
   }` means field `responsibility` in model `ConfigurationItem` reference model `User` which generates 1-1 relation



* `
  "maintainers": {
            "type": "array",
            "items": { "type": "string", "schema":"User"},
            "uniqueItems": true
  }` means field `maintainers` in model `ConfigurationItem` is an array each reference model `User` which generates 1-n relation


* `
  "search":{"index":"cfgItem"}
  ` means instance of `ConfigurationItem` will also stored into elasticsearch with `cfgItem` as index name

## Search

* query interfaces which use mongodb and elasticsearch dsl directly

```mongodb
api/searchByMql
{
    "category":"ITService",
    "body":{
      "name":"email",
      "description":"dns9"
    }
}
```

`category` is id of the model,`body` which is a valid [mongodb query filter](https://docs.mongodb.com/manual/core/document/#document-query-filter)


```elasticsearch
api/searchByEql
{
  "category":"ConfigurationItem",
  "body":
  {
      "query": {
      	"bool":{
      		"must":[
      			{"match": {"category": "Router"}},
      			{"match":{"status.status":"In_Use"}},
      			{"match":{"it_service":"{{service_email_id}}"}}
      		]
      	}

      },
      "sort" : [
          { "product_date" : {"order" : "desc"}}]
  }
}
```

`category` is id of the model,`body` is the valid [elasticsearch query filter](https://www.elastic.co/guide/en/elasticsearch/reference/current/query-filter-context.html)


## Deploy

1. install db server

 [mongodb](https://docs.mongodb.com/manual/installation/)

 [elasticsearch](https://www.elastic.co/guide/en/elasticsearch/reference/master/_installation.html)

 [redis](https://redis.io/topics/quickstart)

2. install npm dependencies

    npm install

3. configuration

    modify value in config/default.json to match db configuration

    ```
      "mongo": {
          "host": "localhost",
          "port": 27017,
          "db": "test"
       },
      "elasticsearch":{
        "host": "localhost",
        "port": 9200,
        "requestTimeout":3000,
        "mode": "strict"
      },
      "redis": {
        "host": "localhost",
        "port": 6379
      },
    ```


4. init Schema

    npm run init

mongodb is schemaless but elasticsearch is not,so run initSchema to build schema in elasticsearch with the [template](https://www.elastic.co/guide/en/elasticsearch/reference/current/dynamic-templates.html) as following

`
{

    "mappings": {
        "doc": {
            "dynamic_templates": [
                {
                    "string_as_date": {
                        "match_pattern": "regex",
                        "match":   ".*_date$|.*_time$|created|lastUpdated",
                        "mapping": {
                            "type": "date"
                        }
                    }
                },
                {
                    "string_as_keyword": {
                        "match_mapping_type": "string",
                        "unmatch": "*_pinyin",
                        "mapping": {
                            "type": "keyword"
                        }
                    }
                }
            ]
        }
    }
}

`


5. start

    npm start
    

6. run integration test cases with [postman](https://www.getpostman.com/docs/)

    npm test

