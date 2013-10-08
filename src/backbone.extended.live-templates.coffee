# Setup - - - - - - - - - - - - - - - - - - - - - - - - - -

requireCompatible = typeof require is 'function'
isNode = typeof module isnt 'undefined'

Backbone = @Backbone or requireCompatible and require 'backbone'

config =
  dontRemoveAttributes: false
  dontStripElements: false
  logExpressionErrors: true
  logCompiledTemplate: true

expressionFunctionCache = {}
templateCache = {}

reservedWords = 'break case catch continue debugger default delete
  do else finally for function if in instanceof new return switch this
  throw try typeof var void while with true false null undefined'.split /\s+/


# Utils - - - - - - - - - - - - - - - - - - - - - - - - - -

escapeQuotes    = (string) -> string.replace /'/g, '&#39;'
unescapeQuotes  = (string) -> string.replace /\&\#39\;/g, "'"
encodeAttribute = (object) -> escapeQuotes JSON.stringify object
decodeAttribute = (string) -> JSON.parse unescapeQuotes string or ''
isExpression    = (string) -> not /^[$\w_\.]+$/.test string.trim()

escapeForRegex = (str) ->
  str.replace /[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, '\\$&'

deserialize = (string) ->
  string = string.trim()
  if string is 'null'                then return null
  if string is 'undefined'           then return undefined
  if string is 'true'                then return true
  if string is 'false'               then return false
  if not isNaN (num = Number string) then return num
  string

zip = (arrays...) ->
  res = []
  arrayLengths = ( array.length for array in arrays )
  for item, index in new Array Math.max arrayLengths...
    for array in arrays
      res.push item if ( item = array[index] )
  res


# LiveTemplates - - - - - - - - - - - - - - - - - - - - - -

liveTemplates = (context, config = {}, options) ->
  template = @template or config.template or @$el.html()
  @liveTemplate = hiddenDOM: [], singletons: config.singletons or {}
  @liveTemplate.singletons.view ?= @
  $template = liveTemplates.create template, @
  @liveTemplate.$template = $template
  @$el.empty().append $template


# Helpers - - - - - - - - - - - - - - - - - - - - - - - - -

# FIXME: there has to be a cleaner, higher performance way of doing this
#     with a regex rather than looping through an array
wrapExpressionGetters = (expression, scope) ->
  regex = /[$\w][$\w\d\.]*/gi
  dependencies = []

  stringSplit = expression.split /'[\s\S]*?'/
  strings = ( expression.match /'[\s\S]*?'/g ) or []

  splitReplace = stringSplit.map (string) =>
    string.replace regex, (keypath) ->
      return keypath if keypath in reservedWords or /'|"/.test keypath
      if keypath.indexOf('$window.') isnt 0 and keypath.indexOf('$view.') isnt 0
        dependencies.push keypath
      "getProperty( context, '#{ keypath }' )"

  newExpressionString = zip(splitReplace, strings).join ' '

  [ newExpressionString, dependencies ]

parseExpression = (context, expression, scope) ->
  if isExpression expression
    expressionIsNotSimpleGetter = true

  if expressionIsNotSimpleGetter
    [ newExpressionString, dependencies ] = \
      wrapExpressionGetters expression, scope

    if expressionFunctionCache[newExpressionString]
      fn = expressionFunctionCache[newExpressionString]
    else
      try
        fn = new Function 'context', 'getProperty',
          "return (#{newExpressionString})"
      catch error
        error.message =                     "\n" +
          "    LiveTemplate parse error:     \n" +
          "        error: #{ error.message } \n" +
          "        expression: #{ expression }"
        throw error

      expressionFunctionCache[newExpressionString] = fn

  string: expression
  fn: fn
  dependencies: dependencies
  isExpression: expressionIsNotSimpleGetter

getExpressionValue = (context, parsed, expression, scope) ->
  if parsed.isExpression
    try
      res = parsed.fn context, getProperty, expression, config
    catch error
      if config.logExpressionErrors
        console.info (
          "[INFO] Template error caught:      \n" +
          "       Expression: #{ expression } \n" +
          "       Message: #{ error.message } \n"
        )

    if typeof res is 'string' then deserialize res else res
  else
    context.get expression.trim()

bindExpression = (context, expression, scope, callback) ->
  parsed = parseExpression context, expression, scope

  changeCallback = ->
    value = getExpressionValue context, parsed, expression, scope
    if callback then callback value else value

  if parsed.dependencies
    for dep in parsed.dependencies
      if dep[0] is '$'
        split = dep.split('.')
        singletonName = split.substring 1
        singleton = context.liveTemplate.singletons[singletonName]
        propertyName = split.slice(1).join '.'
        context.listenTo singleton, "change:#{ propertyName }"
      else if dep.indexOf('$window.') isnt 0 and dep.indexOf('$view.') isnt 0
        context.on "change:#{ dep }", changeCallback

  changeCallback()

stripBoundTag = ($el) ->
  $placeholder = $(document.createTextNode '').insertBefore $el
  $contents = $el.contents()
  $contents.insertAfter $placeholder
  $el.remove() unless config.dontStripElements
  $contents: $contents
  $placeholder: $placeholder

# Allow coffeescript! if compiling have separate flag to first
#    coffee compile
#
# Expressions:
#    $window.Math.random( foo )
#    foo.bar.baz()
#    window.alert
#    $app.foo
#    $user.bar( foo, bar, baz.foo(), Math.random() )
#    $view.foo( bar )
#
getProperty = (context, keypath, localOptions) ->
  # TODO: parse localOptions for index, replacements
  if keypath.indexOf('$window.') is 0
    res = window
    for value in keypath.split('.').slice 1
      res = res[value] if res
    res
  else if keypath.indexOf('$view.') is 0
    res = @
    for value in keypath.split('.').slice 1
      res = res[value] if res
    res
  else if keypath[0] is '$'
    split = keypath.split '.'
    singleton = keypath[0]
    try
      context.liveTemplate.singletons[singleton].get split.slice(1).join '.'
  else
    try
      context.get keypath


# Template Replacers - - - - - - - - - - - - - - - - - - - -

# TODO:
#   {{> partial}}
#   {{* static}}   text replacements
#   {{% special}}  e.g. {{%outlet 'foobar'}}
#
#   Compress (strip whitespace form) HTML
#
#   Coffeescript
#
#   Blocks in attributes
#     e.g. class="{{#if foo}} foo {{/if}}"
#
#   Wrap attributes
#     e.g. <input type="text" {{ validate ? 'validate' : '' }} >
#
templateReplacers = [
  # Hbs comments
  regex: /\{\{![\s\S]*?\}\}/g
  replace: (match) -> ''
,
  # HTML comments
  regex: /<!--[\s\S]*?-->/g
  replace: (match) -> '' # TODO: config to preserve comments
,
  regex: /<([\w\-_]+?)[^<>]*?\{\{[\s\S]+?\}\}[^<]*?>/g
  replace: (context, match, tagName) ->
    bindings = []
    originalMatch = match
    bindings = []
    attributeRe = /([\w\-_]*\s*)=\s*"([^"]*?\{\{[\s\S]+?\}\}[\s\S]*?)"/g
    replacement = match.replace attributeRe, (match, attrName, attrString) =>
      attrExpressionString = "'#{ attrString }'"
        .replace /(\{\{)|(\}\})/g, (match, isOpen, isClose) =>
          if isOpen then "' + (" else if isClose then ") + '" else ''

      bindings.push
        type: 'attribute'
        expression: attrExpressionString.trim()
        attribute: attrName

      ''

    replacement = replacement.replace /(\/?>)/g,
      """ data-bind=' #{ encodeAttribute bindings }' $1"""
    replacement
,
  # Text tags
  #   e.g. {{ foo }}
  regex: /\{\{[\s\S]*?\}\}/g
  replace: (context, match) ->
    attribute = encodeAttribute [
      type: 'text'
      expression: (match.substring 2, match.length - 2).trim()
    ]

    """<bound data-bind='#{ attribute }'></bound>"""
]

replaceTemplateBlocks = (context, template) ->
  mustacheBlockRe = /(\{\{#[\s\S]+?\}\})([\s\S]*?)(\{\{\/[\s\S]*?\}\})/g
  mustacheBlocks = template.match mustacheBlockRe

  # Block tags, e.g. {#if}, {#each} - - - - - - - - - - - - - - - - - -
  while mustacheBlocks and mustacheBlocks.length
    lastMatch = RegExp.lastMatch

    template = template.replace lastMatch, =>
      openTag = RegExp.$1
      body = RegExp.$2
      tag = openTag.substring 2, openTag.length - 2
      spaceSplit = tag.split " "
      attribute = encodeAttribute [
        # susbtring 1 to remove the '#',  as in {{#if}}
        type: spaceSplit[0].substring 1
        expression: (spaceSplit.slice(1).join " ").trim()
      ]

      """<bound data-bind='#{ attribute }'>#{ body }</bound>"""

    mustacheBlocks = template.match mustacheBlockRe
  template


# Template helpers - - - - - - - - - - - - - - - - - - - - -

ifUnlessHelper = (context, binding, $el, inverse) ->
  stripped = stripBoundTag $el
  $contents = stripped.$contents
  $placeholder = stripped.$placeholder

  isInserted = true
  bindExpression context, binding.expression, (result) =>
    result = not result if inverse

    if result and not isInserted
      $contents.insertAfter $placeholder
      hiddenDOM = context.liveTemplate.hiddenDOM
      hiddenDOM.splice hiddenDOM.indexOf($contents), 1
      isInserted = true
    else if not result and isInserted
      context.liveTemplate.hiddenDOM.push $contents
      $contents.remove()
      isInserted = false

templateHelpers =
  # TODO:
  #     {{$index}}
  each: (context, binding, $el, scope) ->
    template     = $el.html()
    stripped     = stripBoundTag $el
    $placeholder = stripped.$placeholder
    inSplit      = binding.expression.split ' in '
    inSyntax     = binding.expression.split(' ')[1] is 'in'
    expression   = if inSyntax then inSplit[1] else binding.expression
    value        = getProperty context, expression
    propertyMap  = inSplit[0] if inSyntax
    collection   = null
    oldValue     = null
    currentValue = null

    items = []
    window.items = items

    insertItem = (model, index) =>
      # MAJOR FIXME: this won't accept
      scope =
        model: model
        mappings: {}
        index: index

      scope.mappings[propertyMap] = expression if inSyntax

      $item = liveTemplates.create template, context, scope
      items.push $item
      $item.insertBefore $placeholder

    removeItem = ($el) =>
      $el.remove()
      items.splice items.indexOf($el), 1

    reset = (value) =>
      currentValue = value
      item.remove() for item in items
      items = []
      value.forEach insertItem if value and value.forEach

    render = (value) =>
      reset value
      @stopListening oldValue if oldValue

      if value and value.on
        @listenTo value, 'add', insertItem
        @listenTo value, 'remove', removeItem
        @listenTo value, 'reset', => reset value

      oldValue = value

    bindExpression context, expression, scope, render

  attribute: (context, binding, $el, scope) ->
    bindExpression context, binding.expression, scope, (result) =>
      $el.attr binding.attribute, result or ''

  if: (context, binding, $el, scope) ->
    ifUnlessHelper arguments...

  unless: (context, binding, $el, scope) ->
    ifUnlessHelper arguments..., true

  text: (context, binding, $el, scope) ->
    stripped = stripBoundTag $el
    stripped.$contents.remove()
    textNode = stripped.$placeholder[0]
    bindExpression context, binding.expression, scope, (result) =>
      textNode.textContent = result or ''

  outlet: (context, binding, $el, scope) ->
    parsed = parseExpression context, binding.expression, scope
    value = getExpressionValue context, parsed, binding.expression, scope
    @$[value] ?= $()
    @$[value].add $el


# Public methods - - - - - - - - - - - - - - - - - - - - - -

_.extend liveTemplates,
  create: (template, context, scope) ->
    compiled = @compileTemplate template, context
    fragment = @createFragment compiled, context
    bound = @bindFragment fragment, context, scope
    bound

  compileTemplate: (template = '', context) ->
    return cached if ( cached = templateCache[template] )

    newTemplate = replaceTemplateBlocks context, template
    for replacer, index in templateReplacers
      newTemplate = newTemplate.replace replacer.regex, (args...) =>
        replacer.replace context, args...

    if config.logCompiledTemplate
      console.info '[INFO] Compiled template:\n', newTemplate

    templateCache[template] = newTemplate
    newTemplate

  createFragment: (template, context) ->
    $("<div>").html template

  bindFragment: ($template, context, scope) ->
    $template.find('[data-bind]').each (index, el) =>
      $el = $ el
      bindings = decodeAttribute $el.attr 'data-bind'

      for binding in bindings
        helper = templateHelpers[binding.type]
        if helper
          helper.call context, context, binding, $el, scope
        else
          throw new Error "No helper of type #{ binding.type } found"

      $el.removeAttr('data-bind') unless config.dontRemoveAttributes

    $template.contents()


# Export - - - - - - - - - - - - - - - - - - - - - - - - - -

liveTemplates.helpers = templateHelpers
liveTemplates.config = config

if Backbone and Backbone.extensions and Backbone.extensions.view
  Backbone.extensions.view.liveTemplates = liveTemplates

if isNode
  module.exports = liveTemplates

if requireCompatible and typeof define is 'function'
  define 'live-templates', ['backbone', 'backbone.extended'] -> liveTemplates
