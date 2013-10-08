   bvvb
isExpression = (string) -> not /^[$a-z_\.]+$/.test string.trim()

# Utils - - - - - - - - - - - - - - - - - - - - - - - - - -

escapeForRegex = (str) ->
  str.replace /[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, '\\$&'

escapeQuotes    = (string) -> string.replace /'/g, "\\'"
unescapeQuotes  = (string) -> string.replace /\\'/g, "'"
encodeAttribute = (object) -> escapeQuotes JSON.stringify object
decodeAttribute = (string) -> JSON.parse unescapeQuotes string or ''

liveTemplates = (context, config = {}, options) ->
  template = @template or config.template
  @liveTemplate = hiddenDOM: [], singletons: config.singletons or {}
  @liveTemplate.singletons.view ?= @
  $template = liveTemplates.init template, @
  @liveTemplate.$template = $template
  @$el.empty().append $template


# Helepers - - - - - - - - - - - - - - - - - - - - - - - - -

parseExpression = (context, expression) ->
  # FIXME: this breaks if string contains ' in ' or ' instanceof '
  #   e.g. {{#if foo === 'hello in vegas' }}
  regex = /[$a-z\.]+/gi
  dependencies = []

  newExpressionString = expression.replace regex, (keypath) =>
    if keypath.indexOf('$window.') isnt 0 and keypath.indexOf('$view.') isnt 0
      dependencies.push keypath
    "getProperty( context, '#{ keypath }' )"

  if isExpression expression
    expressionIsExpression = true

  if expressionIsExpression
    if expressionFunctions[newExpressionString]
      fn = expressionFunctions[newExpressionString]
    else
      fn = new Function 'context', 'getProperty', 'expression', 'config',
        "try {
          return #{ newExpressionString }
        } catch (error) {
          if (config.logExpressionErrors)
            console.info('[INFO] Template error caught: \\n' +
              '       Expression:' + expression + '\\n' +
              '       Message:' + error.message)
        }"
      expressionFunctions[newExpressionString] = fn

  string: expression
  fn: fn
  dependencies: dependencies
  isExpression: expressionIsExpression

bindExpression = (context, binding, callback) ->
  parsed = parseExpression context, binding.expression

  changeCallback = ->
    if parsed.isExpression
      res = parsed.fn context, getProperty, binding.expression, config
      if callback then callback res else res
    else
      res = context.get binding.expression.trim()
      if callback then callback res else res

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
#    Math.random( foo )
#    foo.bar.baz()
#    window.alert
#    $app.foo
#    $user.bar( foo, bar, baz.foo(), Math.random() )
#    $view.foo( bar )
#
getProperty = (context, keypath) ->
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

# TODO:
#   {{> partial}}
#   {{* static}}   text replacements
#   {{% special}}  e.g. {{%outlet 'foobar'}}
templateReplacers = [
  # Comments
  regex: /\{\{![\s|\S]*?\}\}/g
  replace: -> ''
# ,
#   # Wrapping attributes
#   #   e.g. <input {{ validate ? 'validate' : '' }}>
#   regex: /<[^<>]*?\{\{.+?\}\}[^<]*?>/g
#   replace: (context, match) -> # TODO
,
  regex: /<([a-z\-_]+?)[^<>]*?\{\{.+?\}\}[^<]*?>/gi
  replace: (context, match, tagName) ->
    bindings = []
    originalMatch = match
    bindings = []
    attributeRe = /([a-z\-_]*\s*)=\s*"([^"]*?\{\{.+?\}\}.*?)"/gi
    replacement = match.replace attributeRe, (match, attrName, attrString) =>
      attrExpressionString = """ "#{ attrString } " """
        .replace /(\{\{)|(\}\})/g, (match, isOpen, isClose) =>
          if isOpen then '" + (' else if isClose then ') + "' else ''

      bindings.push
        type: 'attribute'
        expression: attrExpressionString
        attribute: attrName

    replacement = replacement.replace /(\/?>)/g,
      """ data-bind=' #{ encodeAttribute bindings }' $1"""
    replacement
,
  # Text tags
  #   e.g. {{ foo }}
  regex: /\{\{.*?\}\}/
  replace: (context, match) ->
    attribute = encodeAttribute [
      type: 'text'
      expression: match.substring 2, match.length - 2
    ]

    """<bind data-bind='#{ attribute }'></bind>"""
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
        # susbtring 1 to remove the # (as in {{#if}})
        type: spaceSplit[0].substring 1
        expression: spaceSplit.slice(1).join " "
      ]

      """<bound data-bind='#{ attribute }'>#{ body }</bound>"""

    mustacheBlocks = template.match mustacheBlockRe
  template

ifUnlessHelper = (context, binding, $el, inverse) ->
  stripped = stripBoundTag $el
  $contents = stripped.$contents
  $placeholder = stripped.$placeholder

  isInserted = true
  bindExpression context, binding, (result) =>
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
  each: (context, binding, $el) ->
    $placeholder = $(document.createTextNode '').insertBefore $el
    template = $el.html()
    $el.empty()
    stripped = stripBoundTag $el
    $placeholder = stripped.$placeholder
    split = binding.expression.split ' '

    # _.last is used here for {{#each foo in bar}}
    keyName = _.last split
    value = getProperty context, keyName
    inSyntax = _.contains binding.expression, ' in '
    propertyMap = split[0] if inSyntax
    collection = null
    oldValue = null

    items = []
    window.items = items

    insertItem = (model) =>
      # MAJOR FIXME: this won't accept
      $item = liveTemplates.init template, model
      items.push $item
      $item.insertBefore $placeholder

    removeItem = ($el) =>
      $el.remove()
      items.splice items.indexOf($el), 1

    reset = (value) =>
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

    bindExpression context, binding, render

  attribute: (context, binding, $el) ->
    bindExpression context, binding, (result) =>
      $el.attr binding.attribute, result or ''

  if: (context, binding, $el) ->
    ifUnlessHelper arguments...

  unless: (context, binding, $el) ->
    ifUnlessHelper arguments..., true

  text: (context, binding, $el) ->
    bindExpression context, binding, (result) =>
      $el.text result or ''

  outlet: (context, binding, $el) ->

_.extend liveTemplates,
  init: (template, context) ->
    compiled = @compileTemplate template, context
    fragment = @createFragment compiled, context
    bound = @bindFragment fragment, context
    bound

  compileTemplate: (template = '', context) ->
    template = replaceTemplateBlocks context, template
    for replacer in templateReplacers
      template = template.replace replacer.regex, (args...) =>
        replacer.replace context, args...
    template

  createFragment: (template, context) ->
    $("<div>").html template

  bindFragment: ($template, context) ->
    $template.find('[data-bind]').each (index, el) =>
      $el = $ el
      bindings = decodeAttribute $el.attr 'data-bind'

      for binding in bindings
        helper = templateHelpers[binding.type]
        if helper
          helper.call context, context, binding, $el
        else
          throw new Error "No helper of type #{ binding.type } found"

      $el.removeAttr('data-bind') unless config.dontRemoveAttributes

    $template.contents()

liveTemplates.helpers = templateHelpers
liveTemplates.config = config
Backbone.extensions.view.liveTemplates = liveTemplates
