liveTemplates =
  _addTemplateHelpers: ->
    matches = (argStrings, options) ->
      conditions = []
      ctx = options.ctx
      argStrings = [argStrings]  unless argStrings instanceof Array
      argStrings.forEach (arg) ->
        return  unless arg
        if _.contains(["&&", "||"], arg)
          conditions.push arg
          return
        condition = undefined
        split = arg.split(conditionalSplitter)
        leftSide = ctx._parseObjectGetter(split[0], options.context, options.altContext).value
        rightSide = ctx._parseObjectGetter(split[1], options.context, options.altContext).value
        if _.contains(arg, "!=")
          condition = leftSide isnt rightSide
        else if _.contains(arg, ">=")
          condition = leftSide >= rightSide
        else if _.contains(arg, "<=")
          condition = leftSide <= rightSide
        else if _.contains(arg, ">")
          condition = leftSide > rightSide
        else if _.contains(arg, "<")
          condition = leftSide < rightSide
        else if _.contains(arg, "=")
          condition = leftSide is rightSide
        else
          condition = leftSide
        conditions.push condition

      nextStep = undefined
      comparator = undefined
      i = 0
      match = conditions[0]
      while i < conditions.length
        comparator = conditions[i + 1]
        if comparator is "&&"
          match = match and conditions[i + 2]
        else match = match or conditions[i + 2]  if comparator is "||"
        i = i + 2
      match
    ifUnlessHandler = (options, inverse) ->

      # TODO add support for multiple if args
      update = (first) ->
        val = matches(argStrings, options)
        val = not val  if inverse

        # logDebounced('*pre update*', options);
        return  if not first and val is lastVal

        # logDebounced('*update*', options);
        if val
          $el.insertAfter $placeholder
        else
          $el.detach()
        lastVal = val
      self = this
      binder = (if options.context and options.context.get then options.context else options.ctx)
      $placeholder = $(document.createTextNode("")).insertAfter(options.$el)
      $el = options.$el.detach().contents()
      ctx = options.ctx
      args = options.args
      argStrings = options.argStrings
      lastVal = undefined
      conditionalSplitter = RegExp("=>|<=|!=|=|<|>|\\?|:")
      updaters = argStrings.map((item) ->
        item.split(conditionalSplitter)[0]
      )

      # FIXME: broken if its foo.length > 2
      updaters.forEach (updater, index) ->

        # binder.on('change:' + updater.split('.')[0].replace('!', ''), update.bind(null, null));
        ctx = options.argContexts[index] and options.argContexts[index].on and options.argContexts[index] or binder
        # FIXME: add negations
        propName = options.argPropNames[index].replace("!", "").split(conditionalSplitter)[0]
        options.ctx.listenTo ctx, "change:" + propName, update.bind(null, null)

      update true

    ifBlockHelper = (options) ->
      body = options.body
      condition = options.condition
      tagName = options.tagName
      conditionSplit = body.split("{else}")
      trueCondition = (if tagName is "if" then conditionSplit[0] else conditionSplit[1])
      falseCondition = (if tagName is "if" then conditionSplit[1] else conditionSplit[0])

      # FIXME: also allow if:condition:value to match a value to a condition (if prop = value)
      re = ((if trueCondition then "<" + boundTagName + " data-bind=\"if:" + condition.replace("\"", "\\\"") + "\">" + trueCondition + "</" + boundTagName + ">" else "")) + ((if falseCondition then "<" + boundTagName + " data-bind=\"unless:" + condition.replace("\"", "\\\"") + "\">" + falseCondition + "</" + boundTagName + ">" else ""))
      re
    template = @template
    boundTagName = Module.template.config.boundTagName
    conditionalSplitter = RegExp("=>|<=|!=|=|<|>|\\?|:")
    template.registerHelpers
      icon: (name) ->
        args = [].slice.call(arguments_)
        options = args.pop()
        _class = args[1] or options["class"] or ""
        "<i class=\"icon " + _class + " sprite-" + name + "\"></i>"

      if: (options) ->
        ifBlockHelper options

      unless: (options) ->
        ifBlockHelper options

      with: ->

      each: (options) ->
        tmplId = _.uniqueId()
        ctx = options.ctx
        tagName = options.tagName
        ctx.templates = ctx.templates or {}
        ctx.templates[tmplId] = options.body
        "<" + boundTagName + " data-bind=\"" + tagName + ":" + options.args.slice(1).join(" ").replace("\"", "\\\"") + " " + "templateId='" + tmplId + "'\"></" + boundTagName + ">"

    template.registerHandlers
      log: (options) ->
        options.$el.remove()
        (window.log or console.log).apply console, options.args

      action: (options) ->
        getMethod = (string) ->
          cb = options.ctx.__getEventCallback__(string.replace(/'|"/g, ""))
          cb and cb.bind(options.ctx)
        $el = options.$el
        firstArg = options.argStrings[0] or options.args[0] or ""
        firstArg = firstArg.replace(/\[.*?\]/g, (match) ->
          strippedMatch = match.substring(1, match.length - 1)
          options.ctx._parseObjectGetter(strippedMatch, options.context, options.altContext).value
        )
        $el.click getMethod(firstArg)  unless firstArg.split("=")[1]
        _.each options.hashStrings, (callback, event) ->
          $el.on event, getMethod(callback)


      value: (options) ->
        update = ->
          newVal = argContext.get(propName)
          $el.val newVal  if $el.val() isnt newVal
        argContext = options.ctx
        propName = options.argStrings[0]
        $el = options.$el
        $el.keyup ->
          argContext.set propName, $el.val()

        options.ctx.listenTo argContext, "change:" + propName, update
        update()

      class: (options) ->
        unquote = (string) ->
          (string or "").replace /'|"/g, ""
        update = ->
          prop = matches(split[0], options) or options.ctx._parseObjectGetter(split[0], options.context, options.altContext).value
          if prop and split[1]
            $el.addClass split[1]
            $el.removeClass split[2]  if split[2]
          else if prop
            $el.addClass beforeText + prop + afterText
          else if split[1]
            $el.removeClass split[1]
            $el.addClass split[2]  if split[2]
          else
            $el.removeClass beforeText + prop + afterText
        split = options.args.strings[0].split(/:|\?/)
        $el = options.$el
        beforeText = options.hash.strings.beforeText or ""
        afterText = options.hash.strings.afterText or ""
        split[1] = unquote(split[1])
        split[2] = unquote(split[2])
        ctx = options.argContexts[0] or options.ctx
        arg = options.argPropNames[0]
        options.ctx.listenTo ctx, "change:" + arg, update
        update()

      outlet: (options) ->
        outletName = options.args[0]
        options.ctx["$" + outletName] = options.$el

      if: (options) ->
        ifUnlessHandler options

      unless: (options) ->
        ifUnlessHandler options, true

      view: (options) ->
        $el = options.$el
        viewName = options.args[0]
        _options = options.hash
        view = options.ctx.subView(new (require("views/" + viewName))(_.extend(
          parent: options.ctx
        , _options))).render()
        view.$el.insertAfter $el
        $el.remove()
        view.$el.attr _.result(view, "attributes")
        view.$el.addClass _.result(view, "className")

      text: (options) ->
        update = ->
          val = options.ctx._parseObjectGetter(arg, options.context, options.altContext).value
          $textNode[0].nodeValue = (if val then val else (if val is 0 then 0 else ""))
        arg = options.argStrings[0]
        $textNode = $(document.createTextNode(""))
        $textNode.insertAfter options.$el
        options.$el.remove()
        delete options.$el

        update()
        ctx = options.argContexts[0] and options.argContexts[0].on and options.argContexts[0] or options.ctx
        argString = options.argPropNames[0] or arg
        options.ctx.listenTo ctx, "change:" + argString, update

      attr: (options) ->
        update = ->
          prop = options.ctx._parseObjectGetter(split[0], options.context, options.altContext).value
          val = (if prop and split[1] then split[1] else (if not prop and split[2] then split[2] else prop))
          $el.attr attr, beforeText + (val or "") + afterText
        attr = options.argStrings[0]
        split = (options.argStrings[1] or "").split(/:|\?/)
        $el = options.$el
        beforeText = options.hash.beforeText or ""
        afterText = options.hash.afterText or ""
        propName = options.argPropNames[1]
        ctx = options.argContexts[1]
        options.ctx.listenTo ctx, "change:" + propName, update
        update()

      style: (options) ->
        update = ->
          split = options.args.strings[1].split(/:|\?/)
          propName = options.args.strings[0]
          prop = ctx._parseObjectGetter(split[0], options.context, options.altContext).value
          val = prop
          if not prop and split[1]
            val = split[2]
          else val = split[1]  if prop and split[1]
          options.$el.css propName, prefix + val + suffix
        ctx = options.ctx
        prefix = options.hash.beforeText or ""
        suffix = options.hash.afterText or ""
        update()
        baseProp = options.argPropNames[1]
        context = options.argContexts[1] or ctx
        ctx.listenTo context, "change:" + baseProp, update

      each: (options) ->
        update = ->
          filter = options.hash.filter and options.hash.filter.split(",")
          unless isStatic
            propertyValue = ctx._parseObjectGetter(propertyName, context, options.altContext).value
            isCollection = propertyValue instanceof Backbone.Collection
            subject = (if isCollection then propertyValue else _(propertyValue))
          originalObj = subject.models or subject._wrapped
          originalObjIsArray = originalObj instanceof Array
          templates = _(templates).map((itemObj, index) ->
            $item = itemObj.$item
            item = itemObj.item
            if not subject.contains(item) or not originalObjIsArray and not isCollection or item instanceof Object
              $item.remove()
            else
              itemObj
          ).compact().value()
          templates = []  if not originalObjIsArray and not isCollection
          if filter
            filteredSubject = {}
            if propertyValue
              _.each filter, (val) ->
                filteredSubject[val] = propertyValue[val]

            subject = _(filteredSubject)
          index = 0
          subject.each (item, key) ->
            index++
            inTemplate = !!_.find(templates, (itemObj) ->
              itemObj.item is item
            )
            return  if (isArray or isCollection) and inTemplate
            altContext = _.extend({}, options.altContext,
              _index: index
              _key: key
              this: item
            )
            if inFormat
              altContext[options.args.strings[0]] = item
            else altContext[options.args.strings[2]] = item  if asFormat
            context = (if inFormat or asFormat then options.context else item)
            $item = ctx.compileTemplate(tmpl, options.hash.templateId, context, altContext).children()
            $lastItem = (_.last(templates) or {}).$item
            $item.insertAfter $lastItem or $placeholder
            templates.push
              $item: $item
              item: item
              index: index


        ctx = options.ctx
        inFormat = options.args.strings[1] is "in"
        asFormat = options.args.strings[1] is "as"
        moduleContext = options.argContexts[(if inFormat then 2 else 0)]
        propertyValue = options.args[(if inFormat then 2 else 0)]
        propertyName = options.argPropNames[(if inFormat then 2 else 0)]
        $el = options.$el
        isStatic = undefined
        tmpl = ctx.templates and ctx.templates[options.hash.templateId] or ""
        if typeof propertyValue is "string"
          propertyValue = propertyValue.split(/\s*,\s*/)
          isStatic = true
        $placeholder = $(document.createTextNode(""))
        $placeholder.insertAfter $el
        $parent = $el.parent()
        $el.remove()
        isArray = propertyValue instanceof Array
        isCollection = propertyValue instanceof Backbone.Collection
        subject = (if isCollection then propertyValue else _(propertyValue))
        templates = []
        context = options.argContexts[0] or options.ctx
        unless isStatic
          propertyValue.listenTo subject, "add remove reset", update  if isCollection
          ctx.listenTo context, "change:" + propertyName, update
        update()

      views: (options) ->
        $el = options.$el
        ctx = options.ctx
        i = 0
        $placeholder = $(document.createTextNode("")).insertBefore($el)
        $el.remove()
        collectionName = options.args[0]
        viewName = options.args[1]
        collection = ctx[collectionName] or ctx.get(collectionName)
        addView = (model) =>
          view = ctx.subView(new (require("views/" + viewName))(
            model: model
            parent: ctx
          ), viewName + ":" + (model.cid or _.uniqueId())).render()
          view.$el.insertBefore $placeholder

        removeView = (model) =>
          ctx.destroySubView model: model

        updateViews = =>
          collection.each (viewModel) =>
            addView viewModel

        unless collection
          log "*cannot find collection " + collectionName + "*"
          return
        ctx.listenTo collection, "reset", (->
          $el.empty()
          ctx.destroySubViews Utils.hyphensToCamel(viewName)
          updateViews()
        ), this
        ctx.listenTo collection, "add", addView
        ctx.listenTo collection, "remove", removeView
        updateViews()

    template.registerUpdaters val: (options) ->
      options.$el.val options.newValue or ""

    template.registerAttributeBindings
      class: (options) ->
        fullText = options.fullText
        bindings = []
        matches = fullText.match(/[a-z_\-]*\{.*?\}[a-z_\-]*/g)
        _.each matches, (match, index) ->
          tag = match.match(/\{.*?\}/)[0]
          split = match.split(tag)
          beforeText = split[0]
          afterText = split[1]
          bindings.push "class:" + tag.replace(/\{|\}|\s/g, "") + ((if beforeText then " beforeText=" + beforeText else "")) + ((if afterText then " afterText=" + afterText else ""))

        bindings.join ","

      value: (options) ->
        "value: " + options.matches[0]

      style: (options) ->
        match = options.fullText
        string = ""
        fullProperties = (match.replace(/\s*style\s*=\s*"|"\s*$/g, "") or "").split(";")
        fullProperties.forEach (property) ->
          propertySplit = property.split(":")
          propertyName = propertySplit[0].replace(/\s/g, "")
          variable = ((property.match(/\{.+\}/g) or [])[0] or "").replace(/\{|\}/g, "")
          attrSplit = (propertySplit[1] or "").split(/\{.+\}/g)
          propertyPrefix = attrSplit[0]
          propertySuffix = attrSplit[1]
          if propertyName and variable
            string += ["style:", propertyName, variable, "beforeText=&#34;" + propertyPrefix + "&#34;", "afterText=&#34;" + propertySuffix + "&#34;"].join(" ") + ","
            match.replace property, ""

        string



  # Turns our template from <img src="{foo}"> to <img data-bind="src:foo">
  compileTemplate: (template, templateName, context, altContext) ->
    i = 0
    boundTagName = Module.template.config.boundTagName
    template = template or ""

    cachedCompiledTemplate = @constructor._cachedCompiledTemplate
    if false # cachedCompiledTemplate
      template = cachedCompiledTemplate
    else
      blockMatches = template.match(/\{#/g)

      # Block tags, e.g. {#if}, {#each} - - - - - - - - - - - - - - - - - -
      #
      # FIXME: doesn't support in attribute - e.g. <a class="{#if @}that{/}"></a>
      while blockMatches and blockMatches.length
        break  if previousMatchLength is blockMatches.length
        previousMatchLength = blockMatches.length
        lastMatch = _.last(blockMatches)
        index = template.lastIndexOf(lastMatch)
        subTemplate = template.substring(index)
        newSubTemplate = subTemplate.replace /\{\s*#.+?\}(.|\s)*?[^\{]\{\/.*\}/g, (match) =>
          tag = match.match(/\{#.+?\}/g)[0]
          args = tag.replace(/\{|\}/g, "").split(" ")
          condition = args.slice(1).join(" ")
          tagName = args[0].replace("#", "")
          body = match.replace(tag, "").replace(/\{\/.*\}/g, "")
          if Module.template.helpers[tagName]
            return Module.template.helpers[tagName](
              body: body
              ctx: @
              altContext: altContext
              context: context or @
              condition: condition
              tagName: tagName
              args: args
            )
          match
        template = template.replace(subTemplate, newSubTemplate)
        blockMatches = template.match(/\{#/g)

      # Replacements for everything non-block - - - - -

      # Simple tags - - - - - - - - - - - - - - - - - - - - - - - - - - -
      # e.g. {foo} or {foo bar:foo}
      template = template.replace(/\{!.*?\}/g, "").replace(/<[^<>]*?\{.+?\}[^<]*?>/g, (match) =>
        bindings = []
        originalMatch = match
        match = match.replace(/[a-z\-_]*\s*=\s*"[^"]*?\{.+?\}.*?"/g, (match) =>
          split = match.replace(/"|\{|\}/g, "").split("=")
          attr = split.shift()
          binding = split.join("=")
          rawMatches = match.match(/\{.+?\}/g)
          matchRemoved = match.replace(/\{.*?\}/g, "")
          cleanMatches = rawMatches.map((match) ->
            match.replace /\{|\}/g, ""
          )
          attributeBinding = Module.template.attributeBindings[attr]
          if attributeBinding
            bindings.push attributeBinding(
              fullText: match
              attrValue: binding
              matches: cleanMatches
              rawMatches: rawMatches
            )
          else
            _.each cleanMatches, (match) ->
              bindings.push "attr:" + attr + " " + match

          matchRemoved
        )
        tags = match.match(/\{.+?\}/g)
        htmlTagName = ((match.match(/<[a-z\-_]+/i) or "")[0] or "").replace("<", "")
        restr = match
        _.each tags, (tag) =>
          tagStripped = tag.replace(/\{|\}/g, "")
          split = _.compact(tagStripped.split(/\s+/))
          replacement = undefined
          options =
            tagName: split[0]
            context: context or @
            altContext: altContext
            ctx: @
            htmlTagName: htmlTagName
            args: split.slice(1)

          bindingHelper = Module.template.inTagBindings[split[0]]
          if bindingHelper
            output = bindingHelper(options)
            bindings.push output
          else
            bindings.push tagStripped.replace(" ", ": ")
          restr = restr.replace(tag, "")
        res = restr.replace(/(<[^\/]+?)(\/?>.*?)/, "$1 data-bind=\"" + bindings.join(",").replace("\"", "\\\"") + "\" $2")
        res

      ).replace /\{.+?\}/g, (match) =>
        replace = (match) ->
          stripped = match.replace(/\{\s*|\s*\}/g, "")
          whiteSplit = stripped.split(" ")
          split = stripped.split(":")
          property = split[0]
          fn = split[1]
          bindText = (if fn then property + ":" + fn else property)
          args = [].concat(whiteSplit)
          args.shift()
          args.push
            context: context or @
            ctx: @
            template: template
            templateName: templateName
            altContext: altContext

          if whiteSplit[1] and Module.template.helpers[whiteSplit[0]]
            Module.template.helpers[whiteSplit[0]].apply(`undefined`, args) or ""
          else
            bindText = "text:" + bindText  unless whiteSplit[1]
            "<" + boundTagName + " data-bind=\"" + bindText.replace("\"", "\\\"") + "\"></" + boundTagName + ">"
        replace match

    # @.constructor._cachedCompiledTemplate = template;

    # End template text replace - - - - - - - - - - - - - - - - - - - -
    $template = $("<" + boundTagName + " data-template=\"" + templateName + "\"></" + boundTagName + ">").html(template)

    $template.$("[data-bind]").each (index, el) =>
      $el = $(el)
      bindingsArr = []
      bind = $el.attr("data-bind")
      if bind
        bindingsArr.push bind
        $el.removeAttr "data-bind"  if Module.config.templates.removeAttributes
      _.each _.range(i), (n) ->
        attr = $el.attr("data-bind-" + n)
        if attr
          bindingsArr.push attr
          $el.removeAttr "data-bind-" + n  if Module.config.templates.removeAttributes

      bindings = bindingsArr.join(",").match(/[^,']*('[^']+[^,]*'|[^,']+)[^,']*/g) or []
      @handleBindings $el, bindings, context, altContext
    $template

  handleBindings: ($el, bindings, context, altContext) ->
    context = context or @
    _.each bindings, (binding) =>
      helperName = binding.trim().split(" ")[0].split(":")[0].trim()
      binding = binding.replace(new RegExp(helperName + "(:?)", ""), "").trim()
      isSimple = binding.match(/^[a-z_\-]+ [a-z_\-]/i)
      contexts = []
      hash = {}
      hashStrings = {}
      moduleContexts = []
      args = binding.trim().replace(/\s+is\s+/g, "=").replace(/\s+(gt|(is\s+)?greater than)\s*/g, ">").replace(/\s+(lt|(is\s+)?less than)\s*/g, "<").replace(/\s+(gte)\s+/g, ">=").replace(/\s+(lte)\s+/g, "<=").replace(/\s+(and|&)\s+/g, " && ").replace(/\s+(or|\|)\s+/g, " || ").replace(/\s+(then)\s+/g, "?").replace(/\s+(else|otherwise)\s+/g, ":").replace(/\s+(isnt|is not)\s+/g).replace(RegExp("==", "g"), "=").replace(/\s*(\?|:|=|!=|>|<)\s*/g, "$1").match(/\S*"[^"]+"|\S+/g) or []
      _.each args, (arg) =>
        split = arg.split(/!?=/)
        unless typeof split[1] is "undefined"
          hashStrings[split[0]] = split[1]
          hash[split[0]] = @_parseObjectGetter(split[1], context, altContext).value
      contextObjects = []
      argObjects = []
      propNames = []
      args.forEach (arg, index) =>
        parsed = @_parseObjectGetter(arg, context, altContext)
        argObjects.push parsed.value
        contextObjects.push parsed.moduleContext
        propNames.push parsed.propNameString
      handler = Module.template.handlers[helperName]
      argObjects.strings = args
      hash.strings = hashStrings
      if handler
        handler
          args: argObjects
          argStrings: args
          $el: $el
          hash: hash
          hashStrings: hashStrings
          context: context
          argPropNames: propNames
          argContexts: contextObjects
          altContext: altContext
          ctx: @