Backbone = @Backbone or typeof require is 'function' and require 'backbone'


config =
  dontRemoveAttributes: true

expressionFunctions = {}

operators =
  '* / % + - << >> >>> < <= > >= == != === !== & ^ ! | && ||'
    .split(' ')
    .concat ' in  ', ' instanceof '

isExpression = (string) ->
  # FIXME: this will throw false positives of operators in strings
  #   (e.g. 'foo > bar') or if 'in', 'instanceof', !, etc in a string
  for item in operators
    return true if string.indexOf(item) isnt -1
  return false


# Utils - - - - - - - - - - - - - - - - - - - - - - - - - -

escapeForRegex = (str) ->
  str.replace /[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, '\\$&'

escapeQuotes = (string) -> string.replace /'/g, '&#39;'
unescapeQuotes = (string) -> string.replace /&#39;/g, "'"

encodeAttribute = (object) -> escapeQuotes JSON.stringify object
decodeAttribute = (string) -> JSON.parse unescapeQuotes string


liveTemplates = (context, config, options) ->
  template = @template or config.template
  $template = liveTemplates.init template, @
  view.$el.empty().append $template


# Helepers - - - - - - - - - - - - - - - - - - - - - - - - -

parseExpression = (context, expression) ->
  # FIXME: this breaks if string contains ' in ' or ' instanceof '
  #   e.g. {{#if foo === 'hello in vegas' }}
  splitters = escapeForRegex operators.concat('(', ')', ',').join '|'
  regex = new RegExp "(#{ splitters })(.*?)|(.*?)(#{ splitters })"
  dependencies = []

  newExpressionString = expression.replace regex, (match, a, b, c, d) =>
    keypath = b or d
    dependencies.push keypath if keypath.indexOf '$window.' isnt 0
    "getProperty( context, '#{ keypath }' )"

  unless expressionFunctions[newExpressionString]
    expressionFunctions[newExpressionString] = new Function newExpressionString

  fn = expressionFunctions[newExpressionString]

  string: expression
  fn: fn
  dependencies: dependencies

bindExpression = (context, binding, callback) ->
  parsed = parseExpression binding

  changeCallback = ->
    callback parsed.fn()

  if parsed.dependencies
    @on 'change:' + binding.dependencies.join(' change:'), changeCallback

  changeCallback()

stripBoundTag = ($el) ->
  $placeholder = $(document.createTextNode '').insertBefore $el
  $contents = $el.contents()
  $contents.insertAfter $placeHolder
  $el.remove()
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
    for value in keyPath.split
      res = res[value] if res
    res
  else
    try
      val = context.get keypath
    unless val

# TODO:
#   {{> partial}}
#   {{* static}}   text replacements
#   {{% special}}  e.g. {{%outlet 'foobar'}}
templateReplacers = [
  # Comments
  regex: /\{\{![\s|\S]*?\}\}/g
  replace: -> ''
,
  # Wrapping attributes
  #   e.g. <input {{ validate ? 'validate' : '' }}>
  regex: /<[^<>]*?\{\{.+?\}\}[^<]*?>/g
  replace: (context, match) -> # TODO
,
  regex: /<[^<>]*?\{\{.+?\}\}[^<]*?>/g
  replace: (context, match) ->
    bindings = []
    originalMatch = match
    bindings = []
    attributeRe = /([a-z\-_]*\s*)=\s*"([^"]*?\{\{.+?\}\}.*?)"/gi
    match.replace(attributeRe, (match, attrName, attrString) =>
      attrExpressionString = """ "#{ attrString } " """
        .replace /(\{\{)|(\}\})/, (match, isOpen, isClose) =>
          if isOpen
            '" + ('
          else if isClose
            '+ ")'

      bindings.push
        type: 'attribute'
        expression: attrExpressionString
        attribute: attrName

    """ data-bind=" #{ encodeAttribute bindings }"  """
,
  # Text tags
  #   e.g. {{ foo }}
  regex: /\{\{.*?\}\}/
  replace: (context, match) ->
    attribute = encodeAttribute [
      type: 'text'
      expression: match.substring 2, match.length - 2
    ]

    """<bind data-bind="#{ attribute }"></bind>"""
]

replaceTemplateBlocks = (context, template) ->
  mustacheBlockRe = /(\{\{#[\s\S]+?\}\})([\s\S]*?)(\{\{\/[\s\S]*?\}\})/g
  mustacheBlocks = template.mach mustacheBlockRe

  # Block tags, e.g. {#if}, {#each} - - - - - - - - - - - - - - - - - -
  while mustacheBlocks and mustacheBlocks.length
    lastMatch = RegExp.lastMatch

    template = template.replace lastMatch, =>
      openTag = RegExp.$1
      body = RegExp.$2
      tag = openTag.substring 2, openTag.length - 2
      spaceSplit = tag.split " "
      attribute = encodeAttribute [
        type: spaceSplit[0]
        expression: spaceSplit.slice(1).join " "
      ]

      """<bound data-bind="#{ attribute }">#{ body }</bound>"""

    mustacheBlocks = template.match mustacheBlockRe

templateHelpers =
  each: (context, binding, $el) ->
    stripped = stripBoundTag $el
    $contents = stripped.$contents
    $placeholder = stripped.$placeholder

  attribute: (context, binding, $el) ->
    bindExpression context, binding, (result) =>
      $el.attr binding.attribute, result or ''

  if: (context, binding, $el) ->
    stripped = stripBoundTag $el
    $contents = stripped.$contents
    $placeholder = stripped.$placeholder

    isInserted = true
    bindExpression context, binding, (result) =>
      if result and not isInserted
        $contents.insertAfter $placeHolder
      else if not result and isInserted
        $contents.remove()

  unless: (context, binding, $el) ->
    stripped = stripBoundTag $el
    $contents = stripped.$contents
    $placeholder = stripped.$placeholder

    isInserted = true
    bindExpression context, binding, (result) =>
      if result and not isInserted
        $contents.insertAfter $placeHolder
      else if not result and isInserted
        $contents.remove()

  text: (context, binding, $el) ->
    bindExpression context, expression, (result) =>
      $el.text result or ''

  outlet: (context, expression, $el) ->


_.extend liveTemplates,
  init: (template, context) ->
    compiled = @compileTemplate template, context
    fragment = @createFragment compiled, context
    bound = @bindFragment fragment, context
    bound

  compileTemplate: (template = '', context) ->
    template = replaceTemplateBlocks context, template
    for replacer in templateReplaces
      template.replace replacer.regex, (args...) =>
        replacer.replace context, args...

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
Backbone.extensions.view.liveTemplates = liveTemplates
