define(function (require) {
  var Backbone = require('backbone')
    , BackboneAssociations = require('backbone-associations')
    , Logger   = require('singletons/logger')
    , UI       = require.async('singletons/ui')
    , Meta     = require.async('singletons/meta')
    , Utils    = require.async('singletons/utilities')
    , Helpers  = require.async('singletons/helpers')
    , App      = require.async('app')
    , Events   = require.async('singletons/events')
    , config   = require('singletons/config');

  logDebounced = _.debounce(function () {
    log.apply(null, arguments);
  }, 10);

  // Give us 'emit', 'publish', and 'subscribe' method aliases
  var methodAliases = {
    'trigger': ['publish', 'emit'],
    'on': ['subscribe']
  };

  _.each(methodAliases, function (methods, key) {
    methods.forEach(function (method) {
      Backbone.Events[method]
        = Backbone.AssociatedModel.prototype[method]
        = Backbone.Model.prototype[method]
        = Backbone.Collection.prototype[method]
        = Backbone.Router.prototype[method]
        = Backbone.View.prototype[method]
        = Backbone.Events[key];
    });
  });

  function isJqueryEvent(string) {
    var str = string.split(' ')[0];
    // FIXME: there are other jquery events than thers
    return ('on' + str) in window || _.contains(['mouseenter', 'mouseleave'], str);
  }

  function Collection (objects, options) {
    var arr = [];
    arr.push.apply(arr, objects);

    var collection = _.extend(arr, Backbone.Events, {
      push: function () {
        this.add.apply(this, arguments);
      },

      unshift: function () {
        this.bind.apply(this, arguments);
        [].unshift.apply(this, arguments);
      },

      add: function () {
        this.bind.apply(this, arguments);
        [].push.apply(this, arguments);
        return this;
      },

      bind: function () {
        var args = [].slice.call(arguments);
        _.each(args, function (value, key) {
          value.on('all', function () {
            this.trigger.apply(this, arguments);

            // Also fire an event to specify the modules name
            // e.g. 'todoListView:eventName'
            var args = [].slice.call(arguments);
            args[0] = Utils.unCapitalize(value.name || '') + ':' + args[0];
            this.trigger.apply(this, args);
          }, this);
        }.bind(this));
        return this;
      },

      getAll: function (arg, getOnlyOne) {
        var obj, str, fn;
        var results = [];

        switch (typeof arg) {
          case 'object'   : obj = arg ; break;
          case 'string'   : str = arg ; break;
          case 'function' : fn  = arg ; break;
          default:
            return getOnlyOne ? null : [].slice.call(this);
        }

        if (obj) {
          _.each(this, function (item) {
            if (!item)
              return;

            var match = true;
            _.each(obj, function (value, key) {
              if (value !== this[key])
                match = false;
            }.bind(this));
            if (match)
              results.push(item);
          }.bind(this));
        }
        else if (str) {
          _.each(this, function (item) {
            if (!item)
              return;

            if ((item.name || '').toLowerCase() === str.toLowerCase())
              results.push(item);
          }.bind(this));
        }
        else if (fn) {
          _.each(this, function (item) {
            if (fn(item))
              results.push(this);
          });
        }
        return results;
      },

      filter: function () {
        return this.getAll.apply(this, arguments);
      },

      find: function () {
        return this.get.apply(this, arguments);
      },

      // FIXME: have a method for returning one result or all results
      get: function (/* obj | str | fn */) {
        return this[arguments[0]] || this.getAll.call(this, arguments[0], true)[0];
      },

      remove: function (item) {
        var index = this.indexOf(item);
        this.splice(index, 1);
        return this;
      }
    });

    if (options && options.type == 'views')
      _.extend(collection, {
        getView: function (arg) {
          for (var i = 0; i < this.length; i++)
            if (this[i].is(arg))
              return this[i];
        },

        get: function () {
          return this.getView.apply(this, arguments);
        },

        getAll: function () {
          return this.getViews.apply(this, arguments);
        },

        getViews: function (arg) {
          var views = [];
          this.forEach(function (view) {
            if (view.is(arg))
              views.push(view);
          });
          return views;
        }
      });


    return collection;
  }

  var Module = {
    name: 'Module',

    autoInit: true,

    config: {
      templates: {
        boundTagName: 'bound',
        removeAttributes: true
      }
    },

    // Templates - - - - - - - - - - - - - - - - - - - - - -

    _createTemplateInterface: function () {
      var template = this.template;

      function capitalize(str) {
        return str[0].toUpperCase() + str.substring(1);
      }

      // FIXME: add inner-tag bindings
      // FIXME: add block bindings, block helpers
      [
        'helper', 'binding', 'handler', 'attributeBinding', 'updater',
        'inTagBinding', 'inTagHelper'
      ].forEach(function (type) {
        // E.g. template.bindings[name]
        var _type = template[type + 's'] = {};
        template['register' + capitalize(type)] = function (name, callback) {
          _type[name] = callback;
        };

        template['register' + capitalize(type) + 's'] = function (obj) {
          _.extend(_type, obj);
        };
      });
    },

    template: {
      config: {
        boundTagName: 'bound'
      }
    },

    // End templates - - - - - - - - - - - - - - - - - - - -


    initialize: function () {
      // FIXME: make these _
      this._createTemplateInterface();
      this._registerMethodFilters();
      this._addJqueryFns();
      this._addHandlebarsHelpers();
      this._addTemplateHelpers();
      this._addUnderscoreMixins();

      return this;
    },

    filters: {},

    _addUnderscoreMixins: function () {
      _.mixin({
        slice: function (arrayOrArrayLikeObject) {
          return [].slice.call(arrayOrArrayLikeObject);
        }
      });
    },

    // FIXME: this doesn't work yet
    observes: function () {
      var args = _.slice(arguments);
      var callback = args.shift();
      var called = false;
      var uniqueId = _.uniqueId();

      function response () {
        if (!called) {
          var name;
          _.each(this, function (value, key) {
            if (!key && value === response)
              name = key;
          }.bind(this));

          this.bindMethod(name, args);
          called = true;
        }

        callback.apply(this, arguments);
      }

      response.id = uniqueId;
    },

    registerFilter: function (name, fn) {
      this.filters[name] = fn;
    },

    registerFilters: function (obj) {
      _.extend(this.filters, obj);
    },

    _registerMethodFilters: function () {
      this.registerFilters({
        defer: function (callback) {
          return UI.nextUpdate.bind(UI, callback);
        },

        throttle: function (callback, duration) {
          return _.throttle(callback, duration || 100);
        },

        debounce: function (callback, duration, immediate) {
          return _.throttle(callback, duration || 100, immediate);
        },

        delay: function (callback, duration) {
          return Utils.delay.bind(Utils, duration || 100, callback);
        }
      });
    },

    // FIXME: add support for blocks
    _addTemplateHelpers: function () {
      var template = this.template;
      var boundTagName = Module.template.config.boundTagName;
      var conditionalSplitter = /=>|<=|!=|=|<|>|\?|:/;

      // template.registerInTagBinding('action', function (options) {
      //   var args = options.args;

      //   return args.map(function (arg) {
      //     return 'action:' + arg;
      //   }).join(',');
      // });

      template.registerHelpers({
        icon: function (name) {
          var args = [].slice.call(arguments)
            , options = args.pop()
            , _class = args[1] || options['class'] || '';

          // FIXME: add interpolation
          //  e.g. {{icon "pic-icon   key}}s-small"}}
          // name = interpolate(this, name, options, args);
          return '<i class="icon ' + _class + ' sprite-' + name  +'"></i>';
        },

        // FIXME: move to updater
        'if': function (options) {
          return ifBlockHelper(options);
        },

        unless: function (options) {
          return ifBlockHelper(options);
        },


        // FIXME: allow 'with' and context binding
        // data-bind="with: foobar"
        // {#with foobar}
        // {/with}
        'with': function () {

        },

        // FIXME: move this into the template lib itself
        // storing the body of a tag within the tag
        each: function (options) {
          var tmplId = _.uniqueId()
            , ctx = options.ctx
            , tagName = options.tagName;

          // FIXME: compile template before save so doesn't need recompiling
          ctx.templates = ctx.templates || {};
          ctx.templates[tmplId] = options.body;

          return '<' + boundTagName + ' data-bind="' + tagName + ':' + options.args.slice(1).join(' ').replace('"', '\\"')
             + ' ' + 'templateId=\'' + tmplId + '\'"></' + boundTagName + '>';
        }
      });

      function matches (argStrings, options) {
        var conditions = [];
        var ctx = options.ctx;

        if ( !(argStrings instanceof Array) )
          argStrings = [argStrings];

        argStrings.forEach(function (arg) {
          if (!arg)
            return;

          if (_.contains(['&&', '||'], arg)) {
            conditions.push(arg);
            return;
          }

          var condition
            , split = arg.split(conditionalSplitter)
            , leftSide = ctx._parseObjectGetter(split[0], options.context, options.altContext).value
            , rightSide = ctx._parseObjectGetter(split[1], options.context, options.altContext).value;

          if      (_.contains(arg, '!=')) condition = leftSide != rightSide;
          else if (_.contains(arg, '>=')) condition = leftSide >= rightSide;
          else if (_.contains(arg, '<=')) condition = leftSide <= rightSide;
          else if (_.contains(arg, '>'))  condition = leftSide >  rightSide;
          else if (_.contains(arg, '<'))  condition = leftSide <  rightSide;
          else if (_.contains(arg, '='))  condition = leftSide == rightSide;
          else                            condition = leftSide;

          conditions.push(condition);
        });

        var nextStep;
        var comparator;
        var i = 0;
        var match = conditions[0];
        while (i < conditions.length) {
          comparator = conditions[i + 1];

          if (comparator == '&&')
            match = match && conditions[i + 2];
          else if (comparator == '||')
            match = match || conditions[i + 2];

          i = i + 2;
        }

        return match;
      }

      function ifUnlessHandler (options, inverse) {
        // TODO add support for multiple if args

        var self = this
          , binder = options.context && options.context.get ? options.context : options.ctx
          , $placeholder = $(document.createTextNode('')).insertAfter(options.$el)
          , $el = options.$el.detach().contents()
          , ctx = options.ctx
          , args = options.args
          , argStrings = options.argStrings
          , lastVal;

        var conditionalSplitter = /=>|<=|!=|=|<|>|\?|:/;

        var updaters = argStrings.map(function (item) {
          return item.split(conditionalSplitter)[0];
        });

        function update (first) {
          var val = matches(argStrings, options);

          if (inverse)
            val = !val;

          // logDebounced('*pre update*', options);

          if (!first && val === lastVal)
            return;

          // logDebounced('*update*', options);

          if (val)
            $el.insertAfter($placeholder);
          else
            $el.detach();

          lastVal = val;
        }

        // FIXME: broken if its foo.length > 2
        updaters.forEach(function (updater, index) {
          // binder.on('change:' + updater.split('.')[0].replace('!', ''), update.bind(null, null));
          var ctx = options.argContexts[index]
            && options.argContexts[index].on
            && options.argContexts[index]
            || binder;

          var propName = options.argPropNames[index]
            .replace('!', '') // FIXME: add negations
            .split(conditionalSplitter)[0];

          options.ctx.listenTo(ctx, 'change:' + propName, update.bind(null, null));
        });
        update(true);
      }

      // FIXME: maybe don't split in and out of tag helpers and just pass
      // as option options.inTag or options.outOfTag
      template.registerHandlers({
        log: function (options) {
          options.$el.remove();
          (window.log || console.log).apply(console, options.args);
        },

        action: function (options) {
          var $el = options.$el;

          function getMethod (string) {
            var cb = options.ctx.__getEventCallback__(string.replace(/'|"/g, ''));
            return cb && cb.bind(options.ctx);
          }

          var firstArg = options.argStrings[0] || options.args[0] || '';
          // Allow for bracket interpolation
          // FIXME: make this use squiggly brackets but currently that breaks
          // the template parser
          // e.g. 'set:foo:[this]'
          firstArg = firstArg.replace(/\[.*?\]/g, function (match) {
            var strippedMatch = match.substring(1, match.length -1);
            return options.ctx._parseObjectGetter(strippedMatch, options.context, options.altContext).value;
          });

          if (!firstArg.split('=')[1])
            $el.click(getMethod(firstArg));

          _.each(options.hashStrings, function (callback, event) {
            $el.on(event, getMethod(callback));
          });
        },

        value: function (options) {
          // FIXME: support expressions?
          //    value = "{ someProp + 100 }"
          //    value = "{ Math.round(someProp} }"
          //    value = "{ round(someProp) }"
          //    value = "{ someProp | round }"
          //    value = "hello { someProp }, how are you?"
          //    value = "${ someProp }"

          // FIXME: possibly use UI.nextUpdate for this

          var argContext = options.ctx         // options.argContexts[0]
            , propName = options.argStrings[0] // options.argPropNames[0]
            , $el = options.$el;

          $el.keyup(function () {
            argContext.set(propName, $el.val());
          });

          function update () {
            var newVal = argContext.get(propName);
            if ($el.val() !== newVal)
              $el.val(newVal);
          }

          options.ctx.listenTo(argContext, 'change:' + propName, update);
          update();
        },

        'class': function (options) {
          var split = options.args.strings[0].split(/:|\?/)
            , $el = options.$el
            , beforeText = options.hash.strings.beforeText || ''
            , afterText = options.hash.strings.afterText || '';

          function unquote (string) {
            return (string || '').replace(/'|"/g, '');
          }

          split[1] = unquote(split[1]);
          split[2] = unquote(split[2]);

          function update () {
            var prop = matches(split[0], options) || options.ctx._parseObjectGetter(split[0], options.context, options.altContext).value;

            if (prop && split[1]) {
              $el.addClass(split[1]);

              if (split[2])
                $el.removeClass(split[2]);
            }
            else if (prop) {
              $el.addClass(beforeText + prop + afterText);
            }
            // !prop
            else if (split[1]) {
              $el.removeClass(split[1]);

              if (split[2])
                $el.addClass(split[2]);
            }
            // !prop
            else
              $el.removeClass(beforeText + prop + afterText);
          }

          var ctx = options.argContexts[0] || options.ctx;

          var arg = options.argPropNames[0];

          options.ctx.listenTo(ctx, 'change:' + arg, update);
          update();
        },

        outlet: function (options) {
          var outletName = options.args[0];
          options.ctx['$' + outletName] = options.$el;
        },

        'if': function (options) {
          ifUnlessHandler(options);
        },

        unless: function (options) {
          ifUnlessHandler(options, true);
        },

        view: function (options) {
          var $el = options.$el;
          var viewName = options.args[0];

          var _options = options.hash;
          var view = options.ctx.subView(new (require('views/'+ viewName))(_.extend({
            parent: options.ctx
          }, _options))).render();

          view.$el.insertAfter($el);
          $el.remove();

          view.$el.attr(_.result(view, 'attributes'));
          view.$el.addClass(_.result(view, 'className'));
        },

        text: function (options) {
          var arg = options.argStrings[0];

          var $textNode = $(document.createTextNode(''));
          $textNode.insertAfter(options.$el);
          options.$el.remove();
          delete options.$el;

          function update () {
            var val = options.ctx._parseObjectGetter(arg, options.context, options.altContext).value;
            $textNode[0].nodeValue = val ? val : val === 0 ? 0 : '';
          }

          update();

          var ctx = options.argContexts[0]
            && options.argContexts[0].on
            && options.argContexts[0]
            || options.ctx;

          var argString = options.argPropNames[0] || arg;
          options.ctx.listenTo(ctx, 'change:' + argString, update);
        },

        attr: function (options) {
          var attr = options.argStrings[0];
          var split = (options.argStrings[1] || '').split(/:|\?/);
          var $el = options.$el;

          var beforeText = options.hash.beforeText || '';
          var afterText = options.hash.afterText || '';

          function update () {
            var prop = options.ctx._parseObjectGetter(split[0], options.context, options.altContext).value;
            var val =
              prop && split[1]
              ? split[1]
              : !prop && split[2]
              ? split[2]
              : prop;

            $el.attr(attr, beforeText + (val || '') + afterText);
          }

          var propName = options.argPropNames[1];
          var ctx = options.argContexts[1];
          options.ctx.listenTo(ctx, 'change:' + propName, update);
          update();
        },

        style: function (options) {
          var ctx = options.ctx;
          var prefix = options.hash.beforeText || '';
          var suffix = options.hash.afterText || '';

          function update () {
            var split = options.args.strings[1].split(/:|\?/)
              , propName = options.args.strings[0]
              , prop = ctx._parseObjectGetter(split[0], options.context, options.altContext).value
              , val = prop;

            if (!prop && split[1])
              val = split[2];
            else if (prop && split[1])
              val = split[1];

            options.$el.css(propName, prefix + val + suffix);
          }

          update();

          var baseProp = options.argPropNames[1];
          var context = options.argContexts[1] || ctx;
          ctx.listenTo(context, 'change:' + baseProp, update);
        },

        each: function (options) {
          var ctx = options.ctx
            , inFormat = options.args.strings[1] == 'in'
            , asFormat = options.args.strings[1] == 'as'
            , moduleContext = options.argContexts[inFormat ? 2 : 0]
            , propertyValue = options.args[inFormat ? 2 : 0]
            , propertyName = options.argPropNames[inFormat ? 2 : 0]
            , $el = options.$el
            , isStatic
            , tmpl = ctx.templates && ctx.templates[options.hash.templateId] || '';

          // For {#each 'foo,bar,baz'}
          if (typeof propertyValue == 'string') {
            propertyValue = propertyValue.split(/\s*,\s*/);
            isStatic = true;
          }

          var $placeholder = $(document.createTextNode(''));
          $placeholder.insertAfter($el);
          var $parent = $el.parent();
          $el.remove();

          var isArray = propertyValue instanceof Array
            , isCollection = propertyValue instanceof Backbone.Collection
            , subject = isCollection ? propertyValue : _(propertyValue)
            , templates = [];

          var context = options.argContexts[0] || options.ctx;

          function update () {
            var filter = options.hash.filter && options.hash.filter.split(',');

            if (!isStatic) {
              propertyValue = ctx._parseObjectGetter(propertyName, context, options.altContext).value;
              isCollection = propertyValue instanceof Backbone.Collection;
              subject = isCollection ? propertyValue : _(propertyValue);
            }

            var originalObj = subject.models || subject._wrapped;
            var originalObjIsArray = originalObj instanceof Array;

            templates = _(templates).map(function (itemObj, index) {
              var $item = itemObj.$item;
              var item = itemObj.item;
              if (!subject.contains(item) || !originalObjIsArray && !isCollection || item instanceof Object)
                $item.remove();
              else
                return itemObj;
            }).compact().value();

            if (!originalObjIsArray && !isCollection)
              templates = [];

            // FIXME: Only works if not a backbone model right now
            if (filter) {
              var filteredSubject = {};
              if (propertyValue)
                _.each(filter, function (val) {
                  filteredSubject[val] = propertyValue[val];
                });
              subject = _(filteredSubject);
            }

            var index = 0;
            subject.each(function (item, key) {
              index++;

              var inTemplate = !!_.find(templates, function (itemObj) {
                return itemObj.item === item;
              });

              if ( (isArray || isCollection) && inTemplate)
                return;

              // TODO: move 'clone' to 'privateAttributes' instead of 'altContext'
              var altContext = _.extend({}, options.altContext, {
                '_index': index,
                '_key': key,
                'this': item
              });

              if (inFormat)
                altContext[options.args.strings[0]] = item;
              else if (asFormat)
                altContext[options.args.strings[2]] = item;


              var context = inFormat || asFormat ? options.context : item;

              var $item = ctx.compileTemplate(tmpl, options.hash.templateId,
                context, altContext).children(); // FIXME: this should be .contents() not .children()

              var $lastItem = (_.last(templates) || {}).$item;
              $item.insertAfter($lastItem || $placeholder);

              templates.push({
                $item: $item,
                item: item,
                index: index
              });
            });
          }

          if (!isStatic) {
            if (isCollection) {
              propertyValue.listenTo(subject, 'add remove reset', update);
              // ctx.listenTo(context, 'change:' + propertyName + '[*]', update);
            }

            ctx.listenTo(context, 'change:' + propertyName, update);
          }
          update();
        },

        views: function (options) {
          var $el = options.$el
            , ctx = options.ctx
            , i = 0;

          var $placeholder = $(document.createTextNode('')).insertBefore($el);
          $el.remove();

          var collectionName = options.args[0];
          var viewName = options.args[1];

          var collection = ctx[collectionName] || ctx.get(collectionName);
          var addView = function (model) {
            var view = ctx.subView(new (require('views/' + viewName))({
              model: model,
              parent: ctx
            }), viewName + ':' + (model.cid || _.uniqueId())).render();

            view.$el.insertBefore($placeholder);
          }.bind(this);

          var removeView = function (model) {
            ctx.destroySubView({ model: model });
          };

          var updateViews = function () {
            collection.each(function (viewModel) {
              addView(viewModel);
            }.bind(this));
          }.bind(this);

          if (!collection) {
            log('*cannot find collection ' + collectionName + '*');
            return;
          }

          ctx.listenTo(collection, 'reset', function () {
            $el.empty();
            ctx.destroySubViews(Utils.hyphensToCamel(viewName));
            updateViews();
          }, this);

          ctx.listenTo(collection, 'add', addView);
          ctx.listenTo(collection, 'remove', removeView);
          updateViews();
        }
      });

      // FIXME: call 'handler', not updater
      template.registerUpdaters({
        val: function (options) {
          options.$el.val(options.newValue || '');
        }
      });

      template.registerAttributeBindings({
        'class': function (options) {
          var fullText = options.fullText
            , bindings = []
            , matches = fullText.match(/[a-z_\-]*\{.*?\}[a-z_\-]*/gi);

          _.each(matches, function (match, index) {
            var tag = match.match(/\{.*?\}/)[0]
              , split = match.split(tag)
              , beforeText = split[0]
              , afterText = split[1];

            bindings.push('class:'
              + tag.replace(/\{|\}|\s/g, '')
              + (beforeText ? ' beforeText=' + beforeText : '')
              + (afterText ? ' afterText=' + afterText : '')
            );
          });

          return bindings.join(',');
        },

        value: function (options) {
          return 'value: ' + options.matches[0];
        },

        style: function (options) {
          var match = options.fullText;

          var string = '';
          var fullProperties = (match.replace(/\s*style\s*=\s*"|"\s*$/gi, '') || '').split(';');
          fullProperties.forEach(function (property) {
            var propertySplit = property.split(':')
              , propertyName = propertySplit[0].replace(/\s/g, '')
              , variable = ( ( property.match(/\{.+\}/ig) || [] )[0] || '' ).replace(/\{|\}/g, '')
              , attrSplit = (propertySplit[1] || '').split(/\{.+\}/ig)
              , propertyPrefix = attrSplit[0]
              , propertySuffix = attrSplit[1];

            if (propertyName && variable) {
              string += [
                'style:',
                propertyName,
                variable,
                // &#34; = html escaped quotes (")
                'beforeText=&#34;' + propertyPrefix + "&#34;",
                'afterText=&#34;' + propertySuffix + "&#34;"
              ].join(' ') + ',';

              match.replace(property, '');
            }
          });

          return string;
        }
      });

      // this.template.registerBinding('action', function () {

      // });

      function ifBlockHelper (options) {
        var body = options.body
          , condition = options.condition
          , tagName = options.tagName
          , conditionSplit = body.split('{else}')
          , trueCondition = tagName == 'if' ? conditionSplit[0] : conditionSplit[1]
          , falseCondition = tagName == 'if' ? conditionSplit[1] : conditionSplit[0];

        // FIXME: also allow if:condition:value to match a value to a condition (if prop = value)
        var re  = ( trueCondition ? '<' + boundTagName + ' data-bind="if:' + condition.replace('"', '\\"') + '">'
            + trueCondition +
          '</' + boundTagName + '>' : '') +
          (falseCondition ?
            '<' + boundTagName + ' data-bind="unless:' + condition.replace('"', '\\"') + '">'
              + falseCondition +
            '</' + boundTagName + '>' : '');

        return re;
      }
    },

    _addHandlebarsHelpers: function () {
      // {{log}} helper
      // e.g. {{log foobar}} -> outputs foobar to console
      Handlebars.registerHelper('log', function () {
        var args = [].slice.call(arguments);
        args.unshift('Handlebars Log: ');
        var options = args.pop();
        _.each(options.hash, function (value, key) {
          args.push(key + ':', value);
        });

        if (options.hash.json || _.contains(args, 'json'))
          args.forEach(function (arg, index) {
            args[index] = Utils['try'](JSON.stringify.bind(JSON, arg, null, 2));
          });

        console.log.apply(console, args);
      });

      Handlebars.registerHelper('outlet', function (name, options) {
        return new Handlebars.SafeString(' data-outlet="' + name + '" ');
      });

      // {{action}} helper
      // e.g. {{action "click:set:activeTab:yourStats"}}
      // Handlebars.registerHelper('action', function (/* actions..., options */) {
      //   var args = [].slice.call(arguments);
      //   var options = args.pop();
      //   _.each(options.hash, function (value, key) {
      //     args.push(key + ':' + value);
      //   });

      //   args = args.map(function (arg) {
      //     return interpolate(this, arg, options);
      //   }.bind(this));

      //   return new Handlebars.SafeString('data-action="' + args.join(',') + '"');
      // });

      // // FIXME: the better method is probably {{#if "method()"}} or {{#if "method(arg)"}}
      // where arg can be an item in a list, for example.  Or an index perhaps
      // Shorthand for {{#if do="4 > 3"}}
      Handlebars.registerHelper('ifdo', function (str, options) {
        if (matches(null, { hash: str }))
          return options.fn(this);
        else
          return options.inverse(this);
      });

      Handlebars.registerHelper('unlessdo', function (str, options) {
        if (matches(null, { hash: str }))
          return options.inverse(this);
        else
          return options.fn(this);
      });

      /**
       * Logical matching
       *   Eg:
       *     {{#if true "and" 4 "less than" 3}} {{/if}}
       *     {{#unless foo "is" "baz" "and" foobar "isnt" barfoo}} {{/unless}}
       */
      function matches (args, options) {
        // For {#if "not" foo}
        if (args[0] == 'not') {
          var arg = args.unshift();
          args[0] = !args[0];
        }
        // Allows {{#if exec="foo.length > 5 || ( bar && baz )"}}
        else if (options.hash['do']) {
          with (this) {
            try {
              return eval(options.hash['do']);
            }
            catch (error) {
              // Errors will happen if the input is a single string such as a url
              console.warn('error with template eval', args, error);
              return false;
            }
          }
        }

        // TODO: maybe add {{#if foo ">=" 10 "+" 4}}
        // OR just use {{#if "foo >= (bar.length + 4)"}}

        var notAndSpaceRe = /\s|not|!/gi
          , notRe = /not|!/gi
          , comparisons = []
          , comparison
          , push
          , skipNextPush = false;

        if (args[1]) {
          var i = 0;
          while (i < args.length) {
            if (!args[i + 1])
              break;

            push = true;
            switch (args[i + 1].replace(notAndSpaceRe, '')) {
              case 'equals':
              case 'is':
              case '=':
              case '==':
              case '===':
                skipNextPush = true;
                comparison = args[i] === args[i + 2];
                break;
              case 'isnt':
                skipNextPush = true;
                comparison = args[i] !== args[i + 2];
                break;
              case 'greaterthan':
              case '>':
                skipNextPush = true;
                comparison = args[i] > args[i + 2];
                break;
              case 'lessthan':
              case '<':
                skipNextPush = true;
                comparison = args[i] < args[i + 2];
                break;
              case 'lte':
              case 'lessthanequal':
              case 'lessthanequalto':
              case 'lessthanorequal':
              case 'lessthanorequalto':
              case '>=':
                skipNextPush = true;
                comparison = args[i] >= args[i + 2];
                break;
              case 'gte':
              case 'greaterthanequal':
              case 'greaterthanequalto':
              case 'greaterthanorequal':
              case 'greaterthanorequalto':
              case '<=':
                skipNextPush = true;
                comparison = args[i] <= args[i + 2];
                break;
              case 'and':
              case 'or':
                push = false;

                if (!skipNextPush)
                  comparisons.push(args[i]);
                skipNextPush = false;

                comparisons.push(args[i + 1]);
                break;
            }

            // Allows for 'or not', 'not greater than', 'and not', 'is not', etc
            // must be at very start or very end of string
            if (notRe.test(args[i + 1]))
              comparison = !comparison;

            if (push)
              comparisons.push(comparison);

            i = i + 2;
          }
        }

        var match = comparisons.length ? comparisons[0] : args[0];
        var len = comparisons.length;
        var j = 0;
        while (j < len) {
          if (!comparisons[j + 1])
            break;

          var negates = notRe.test(comparisons[j + 1]);
          switch (comparisons[j + 1].replace(notAndSpaceRe, '')) {
            case 'and':
              match = match && ( negates ? !comparisons[j + 2] : comparisons[j + 2] );
              break;
            case 'or':
              match = match || ( negates ? !comparisons[j + 2] : comparisons[j + 2] );
              break;
          }
          j = j + 2;
        }

        return match;
      }

      Handlebars.registerHelper('if', function () {
        var args = [].slice.call(arguments);
        var options = args.pop();
        var match = matches.call(this, args, options);

        if (match)
          return options.fn(this);
        else
          return options.inverse(this);
      });

      Handlebars.registerHelper('unless', function () {
        var args = [].slice.call(arguments);
        var options = args.pop();
        var match = !matches.call(this, args, options);

        if (match)
          return options.fn(this);
        else
          return options.inverse(this);
      });

      var interpolate = function (context, string, options, args) {
        return string.replace(/\{\{\@?\w+\}\}/, function (match) {
          var str = match.replace(/[\{\}]/g, '')
            , num = parseInt(str, 10)
            , isData = _.contains(str, '@');

          str = str.replace('@', '');
          if (num && !isNaN(num) && args)
            return args[1 + num];
          else
            return str === 'this' ? context : isData ? options.data[str] : options.hash[str];
        });
      };

      Handlebars.registerHelper('icon', function (name /*, [class], options */) {
        var args = [].slice.call(arguments)
          , options = args.pop()
          , _class = args[1] || options['class'] || '';

        name = interpolate(this, name, options, args);

        return new Handlebars.SafeString(
          '<i class="icon ' + _class + ' sprite-' + name  +'"></i>'
        );
      });

      Handlebars.registerHelper('wrapped-icon', function (name /*, [class], [iconClass], options */) {
        var args = [].slice.call(arguments)
          , options = args.pop()
          , _class = args[1] || options['class'] || ''
          , iconClass = args[2] || options['icon-class'] || '';

        return new Handlebars.SafeString(
          '<span class="icon ' + _class + ' ' + name + '-wrapper">' +
            '<i class="sprite ' + iconClass + ' sprite-' + name  +'"></i>' +
          '</span>'
        );
      });

      function each (/* obj, options */) {
        var buffer = ''
          , args = [].slice.call(arguments)
          , options = args.pop()
          , obj = args[0]
          , i = 0
          , data
          , injectOptions;

        if (typeof obj === 'string')
          obj = obj.split(',');

        var isArray = _.isArray(obj);

        _.each(obj, function (value, key) {
          // {{#each "view,buy,money" "in" metrics}}
          // or {{#each "view,buy,money" context=metrics}}
          if (options.hash.context || args[1] == 'in') {
            key = value;
            value = options.hash.context ? options.hash.context[value] : args[2] ? args[2][value] : null;
          }

          if (options.data) {
            data = Handlebars.createFrame(options.data || {});
            injectOptions = {
              key: key,
              value: value,
              index: i++
            };

            data = _.extend({}, data, injectOptions);
          }

          buffer += options.fn(_.extend(_.clone(value || ''), injectOptions, value), { data: data });
        });

        return buffer;
      }

      Handlebars.registerHelper('each', each);

      Handlebars.registerHelper('collection', function () {
        var args = [].slice.call(arguments);
        args[0] = _.extend({}, args[0], args[0].toJSON ? args[0].toJSON() : null);
        return each.apply(undefined, args);
      });

      Handlebars.registerHelper('strip-tag-whitespace', function () {
        return options.fn(this).replace(/>\s+</gi, '><');
      });
    },

    configure: function (options) {
      $.extend(true, this.config, options);
    },

    // Adds optimized/asynchronous veriosn of jquery dom manipulations
    _addJqueryFns: function () {
      var config = {
        methodModifier: '$',
        origininalMethodModifier: '',
        camelize: false
      };

      var UIProxy = { nextUpdate: function (fn, context) {
        setTimeout(fn.bind(context), 1);
      } };

      function newMethodName(methodName) {
        var methodNameEnd = config.camelize
          ? Utils.capitalize(methodName)
          : methodName;

        return config.methodModifier + methodNameEnd;
      }

      $.fn.view = function (onlyExactMatch) {
        var $el = $(this[0]);
        var elIsView = $el.is('[data-view]');

        if (onlyExactMatch && !elIsView)
          return;

        var $viewEl = elIsView ? $el : $el.parents('[data-view]');

        return App.find($el);
      };

      ['model', 'collection'].forEach(function (type) {
        $.fn[type] = function (onlyExactMatch) {
          var $el = $(this[0]);
          var view = $el.view(onlyExactMatch);

          if (!view)
            return;

          var result;
          do {
            result = view['get' + Utils.capitalize(type)]();
            if (result)
              return result;
          }
          while (view = view.parent);
        };
      });

      // Getters with strings + setters
      ['css', 'attr', 'prop'].forEach(function (methodName) {
        var originalMethod = $.fn[methodName];

        if (config.originalMethodModifier)
          $.fn[config.originalMethodModifier + methodName] = originalMethod;

        $.fn[ newMethodName( methodName ) ] = function () {
          var args = arguments;
          if (typeof arguments[0] == 'string')
            return originalMethod.apply(this, args);
          else
            (UI.nextUpdate || UIProxy.nextUpdate)(function () {
              originalMethod.apply(this, args);
            }, this);
          return this;
        };
      });

      // Getter without string + setters
      ['width', 'height', 'scrollTop', 'scrollLeft',
        // 'append', 'prepend', 'appendTo', 'prependTo',
        'html', 'text', 'val', 'insertBefore', 'insertAfter']
        .forEach(function (methodName) {
          var originalMethod = $.fn[methodName];

          if (config.originalMethodModifier)
            $.fn[config.originalMethodModifier + methodName] = originalMethod;

          $.fn[ newMethodName( methodName ) ] = function () {
            var args = arguments;
            if (typeof arguments[0] == 'undefined')
              return originalMethod.apply(this, args);
            else
              (UI.nextUpdate || UIProxy.nextUpdate)(function () {
                originalMethod.apply(this, args);
              }, this);
            return this;
          };
        });

      // Setters
      ['addClass', 'removeClass', 'removeProp', 'removeAttr', 'toggleClass']
        .forEach(function (methodName) {
          var originalMethod = $.fn[methodName];

          if (config.originalMethodModifier)
            $.fn[config.originalMethodModifier + methodName] = originalMethod;

          $.fn[ newMethodName( methodName ) ] = function () {
            var args = arguments;
            (UI.nextUpdate || UIProxy.nextUpdate)(function () {
              originalMethod.apply(this, args);
            }, this);
            return this;
          };
        });
    },

    // Applies to ALL modules
    module: function (obj) {
      if (config.debug.logMethodCallTable) {
        if (Logger.extendModuleToLogMethodCalls)
          Logger.extendModuleToLogMethodCalls(obj);
        else
          console.warn('Utils is not yet defined', obj.name);
      }

      var extender = _.isFunction(obj) ? obj.prototype : obj
        , extenderClone = _.clone(extender)
        , initialize = extender.initialize;

      var origGet = extender.get
        , origSet = extender.set
        , origOn = extender.on
        , origListenTo = extender.listenTo
        // FIXME: implement these (below)
        , origOff = extender.off
        , origStopListening = extender.stopListening;

      _.extend(extender, {
        // Backbone.Wreqr inspired comand and reqres system
        // Add handlers via handlers: { name: res }
        handlers: extender.handlers || {},

        setState: function () {
          return this.state.set.apply(this.state, arguments);
        },

        getState: function () {
          return this.state.get.apply(this.state, arguments);
        },

        // this.computeProperty('foo', ['prop1', 'prop2'], function (prop1, prop2) {
        //   return prop1 + prop2;
        // });
        //
        // this.computeProperty('foo', 'prop1', 'prop1', function (prop1, prop2) {
        //  return prop1 + prop2;
        // });
        //
        // this.computeProperty('name', {
        //   triggers: ['prop1', 'prop2'],
        //   fn: function (prop1, prop2) {
        //     return prop1 + prop2;
        //   }
        // });
        computeProperty: function (/* options */) {
          var args = [].slice.call(arguments);
          var name = args.shift();
          var obj;
          switch (Utils.getType(name)) {
            case 'object':
              obj = args[0];
              break;
            case 'array':
              obj = { triggers: args[0], fn: args[1] };
              break;
            case 'string':
              obj = { fn: args.pop(), triggers: args };
              break;
          }

          var callback = function () {
            var values = obj.triggers.map(function (trigger) {
              // FIXME: don't parse all items on every update
              // should save contexts and property getter strings
              return this._parseObjectGetter(trigger.replace('[*]', ''), this).value;
            }.bind(this));

            var result = obj.fn.apply(this, values);
            this.set(name, result);
          }.bind(this);

          obj.triggers.forEach(function (trigger) {
            var parsed = this._parseObjectGetter(trigger, this);

            this.listenTo(parsed.moduleContext, 'change:' + parsed.propNameString, callback);
            // FIXME: remove this duplicate
            this.on('change:' + trigger, callback);
          }.bind(this));

          callback();
        },

        setHandler: function (name, fn, context) {
          this.handlers[name] = context ? fn.bind(context) : fn;
        },

        // TODO: on change templates need to know to update this value
        bindMethod: function (/* name, properties... */) {
          var args = _.slice(arguments);
          var name = args.shift();
          this.methodBindings = this.methodBindings || {};
          this.methodBindings[name] = args;
        },

        setHandlers: function (handlers) {
          _.each(handlers, function (value, key) {
            if (typeof value == 'function')
              this.setHandler(key, value);
            else if (key == 'app')
              App.setHandlers(value);
            else
              this[key].setHandlers(value);
          }.bind(this));
        },

        removeHandler: function (/* handlerNames... */) {
          _.each(arguments, function (arg) {
            delete this.handlers[arg];
          }.bind(this));
        },

        removeHandlers: function () {
          return this.removeHandler.apply(this, arguments);
        },

        removeAllHandlers: function () {
          this.handlers = {};
        },


        // E.g. foo.bar.@baz.method().foo
        _parseObjectGetter: function (string, context, altContext) {
          context = context || this;
          altContext = altContext || {};

          if (typeof string == 'number')
            string += '';
          else if (!string)
            string = '';

          var moduleContext = context
            , modulePropNameString = string
            , value
            , split = string ? string.match(/[^\.\[\]]+/g) : []
            , propNameString = string
            , contextChain = [context]
            , moduleContextChain = [moduleContext];

          // TODO: also support brackets
          // foo[ bar ]
          // foo[ bar() ]
          // foo[ 'bar' ]

          // TODO: if index == 0
          split.forEach(function (item, index) {
            item = item.trim();

            if (!item)
              return;

            var isGetter = false
              , isMethod = false
              , isString = false
              , isStrictAccessor = false
              , methodArgs;

            if (index > 0) {
              context = value || {};
              contextChain.push(context);
            }

            // TODO: maybe do comparisons too
            //  this='that'

            // TODO: maybe do ternary's too
            //  foo?bar:baz
            //  foo='bar'?bar:baz
            if (_.contains(["'", '"'], item[0]) && index === 0) {
              // FIXME: this
              isString = true;
              // FIXME: this only works if there are no nested quotes
              item = item.replace(/'|"/g, '');
            }
            else if (item[0] == '@') {
              isGetter = true;
              item = item.substring(1);
            }
            else if (item[0] == '*') {
              isStrictAccessor = true;
              item = item.substring(1);
            }
            // TODO: support args that update, e.g. User.@name
            else if (_.last(item) == ')' && _.contains(item, '(')) {
              isMethod = true;
              var methodRe = /(.*?)(\(.*?\))/;
              var argString = item.replace(methodRe, '$2');

              // Remove '(' and ')'
              if (argString[0] == '(')
                argString = argString.substring(1);
              if (_.last(argString) == ')')
                argString = argString.substring(0, argString.length - 1);

              var args = argString.split(/\s*,\s*/);

              args = args.map(function (arg) {
                return this._parseObjectGetter(arg.trim(), context, altContext).value;
              }.bind(this));

              item = item.replace(methodRe, '$1').trim();
              methodArgs = args;
            }

            if (isString) {
              value = item;
            }
            else if (isGetter) {
              moduleContext = context;
              moduleContextChain.push(context);
              value = context.__get__ && context.__get__(item);
            }
            else if (isMethod) {
              if (context[item])
                value = context[item].apply(context, methodArgs);
            }
            else if (isStrictAccessor) {
              value = context[item];
            }
            else {
              value = !index && altContext && altContext[item || 'this']
                // FIXME: this breaks if .get(item) or .at(item) or .[item] === 0
                || context.__get__
                && context.__get__(item)
                || context.at
                && context.at(item)
                || context[item];
            }

            // FIXME: maybe only do this for 'this' or keys starting with '*'
            // if (!value && value !== 0)
            //   value = altContext[item];

            var val;
            if (!value && index === 0) {
              if (item && item.toLowerCase() == 'app')
                value = App;
              else if (item && ( val = App[item.toLowerCase()] ) )
                value = val;
              else if (val = window[item])
                value = val;
            }

            if (context.__get__) {
              moduleContext = context;
              moduleContextChain.push(context);
              propNameString = split.slice(index).join('.').split(/:|\?|=|!=|>|</)[0];
              modulePropNameString = item;
            }
          }.bind(this));

          if (!moduleContext.on)
            moduleContext = this;

          return {
            context: context,
            value: value,
            contextChain: contextChain,
            moduleContextChain: moduleContextChain,
            moduleContext: moduleContext,
            propNameString: propNameString,
            modulePropNameString: modulePropNameString
          };
        },

        // Interface for special callback strings
        // e.g. 'foobar, true # defer, 100 # throttle, 100 + layout, true # delay 20'
        // FIXME: allow methods
        // e.g. set:foo:bar()
        //  addClass:bar()
        //  attr:foo:bar()
        __getEventCallback__: function (value, altContext) {
          var callbacks = [];

          // Support layout # throttle # defer
          _.each(value.split(/\s*\+\s*/g), function (value) {
            // Allows for 'methodName | filter, filterArg'
            // e.g. 'methodName | delay, 100'
            // supports '|' or '#' or '>' or '*' or '%' separation
            // because I can't decide what is prettiest ;)
            var args, fn, filters = [];
            var originalValue = value;
            if (typeof value == 'string') {
              var pipeSplit = value.split(/\s*[|#>*%]\s*/);
              args = pipeSplit.shift().split(/\s*,\s*/g);
              value = args.shift();
              args = args.map(function (item) {
                if (item === 'true')
                  return true;
                else if (item === 'false')
                  return false;
                else if (item && item[0] == '@')
                  return this.get(item.substring(1));
                else if (item && item[0] == '"' || item[0] == "'")
                  return this[item];
                else if (item && item[0] == '{' || item[0] == '[')
                  return Utils.safeJSONParse(item);
                else
                  return item;
              });

              _.each(pipeSplit, function (filter) {
                if (filter) {
                  var filterArgs = filter.split(/\s*?,\s*?/g);
                  filters.push({
                    filterArgs: filterArgs,
                    filterName: filterArgs.shift()
                  });
                }
              });
            }

            if (typeof value == 'string') {
              var split = value.split(':');
              // For prop settings: e.g. set:someVal:something
              if (split[1]) {
                fn = (function () {
                  switch (split[0]) {
                    // toggle:someVal
                    case 'toggle':
                      this.toggle(split[1]);
                      break;
                    // set:someAttr:someValString
                    case 'set':
                      var value = split[2] === 'true' ? true
                        : split[2] === 'false' ? false : split[2];

                      this.set(split[1], value);
                      break;
                    case 'request':
                      var subject = split[2] ? split[1] : null;
                      var request = subject ? split[2] : split[1];
                      if (subject)
                        this[subject].request(request);
                      else
                        this.request(request);
                      break;
                    case 'toggleAttr':
                      this.$el.attr(split[1], !this.$el.attr(split[1]));
                      break;
                    case 'addClass':
                      this.$el.addClass(split[1]);
                      break;
                    case 'toggleClass':
                      this.$el.toggleClass(split[1]);
                      break;
                    case 'removeClass':
                      this.$el.removeClass(split[1]);
                      break;
                    case 'attr':
                      this.$el.attr(split[1], split[2]);
                      break;
                    case 'route':
                    case 'goto':
                    case 'goTo':
                      App.router.go(split[1]);
                      break;
                  }
                });
                response = fn.bind.apply(fn, [altContext || this].concat(args));
              }
              else {
                fn = this[value] || altContext && altContext[value];
                if (!fn)
                  throw new Error((this || altContext) + ' has no method ' + value);
                // FIXME: this breaks if there is no method - e.g. 'foo' but
                // there is no module.foo function
                response = fn.bind.apply(fn, [this[value] ? this : altContext].concat(args));
              }
            }
            else if (typeof value == 'function')
              response = value.bind.apply(value, [altContext || this].concat(args));
            else
              throw new Error('Cannot get callback ' + value);

            if (filters.length)
              _.each(filters, function (filter) {
                response = Module.filters[filter.filterName.trim()]
                  .apply(undefined, [response].concat(filter.filterArgs));
              });

            callbacks.push(response);
          }.bind(this));

          return function () {
            var args = arguments;
            var re;
            _.each(callbacks, function (callback){
              re = callback.apply(undefined, args);
            });
            return re;
          };
        },

        // Give us 'enhanced' events, e.g.
        //
        // events: {
        //   customEventName: function () {},
        //   model: {
        //     modelEvents: 'callbackName'
        //   },
        //   app: {
        //     eventName: 'handler',
        //     sync: {
        //       eventName: 'handler'
        //     }
        //   }
        // }
        //
        // FIXME: make recusrive object lookup
        //  events: {
        //    siblings: {
        //      filterBar: {
        //      }
        //    }
        //  }
        //
        //  events: {
        //    'siblings()': {
        //      filterBar
        //    }
        //  }
        //
        //  events: {
        //    'parent(name)': {
        //
        //    }
        //
        //    // OR
        //
        //    'parent:name': {
        //
        //    }
        //  }
        //
        //  instead of parent: { parent: { parent: { name: 'callback' } } }
        bindAppEvents: function () {
          var events = _.result(this, 'events');
          var customEvents = this.appEvents = {};

          _.each(events, function (value, key) {
            if (/* key.split(' ')[1] === undefined && */!isJqueryEvent(key) ) {
              delete events[key];
              customEvents[key] = value;
            }
          });

          _.each(events, function (callback, name) {
            if (typeof callback == 'string' && _.contains(callback, ':')) {
              delete events[name];
              var split = name.split(' ');
              var eventName = split.shift();
              this.$el.on(eventName, split.join(' '), this.__getEventCallback__(callback));
            }
          }.bind(this));

          _.each(customEvents, function (callback, eventName) {
            var isjQuerySelector = _.contains(['window', 'document', 'body'], eventName)
              || _.contains(['#', ':', '.', '['], eventName[0]);

            // Allows {
            //  window: {
            //    resize: 'bar'
            //  }
            //  document: {
            //    'click a': 'foo'
            //  }
            // }

            if (isjQuerySelector && typeof callback == 'object') {
              var $context = $(eventName == 'window'
                ? window : eventName == 'document'
                ? document : eventName
              );

              _.each(callback, function (callback, event) {
                var split = event.split(' ');
                var evt = split.shift();
                var selector = split.join(' ');
                // FIXME: shouldn't actually bind twice, instead should
                //   determine which type is needed
                //   better workaround: support in all events 'click, touchstart a .something, .foo .bar'
                // for window: { 'click a': 'foo' }
                $context.on(evt, selector, this.__getEventCallback__(callback).bind(this));
                // for window: { 'click touchstart': 'foo' }
                // 'click touchstart'
                $context.on(event, this.__getEventCallback__(callback).bind(this));
              }.bind(this));
            }
            else if (eventName == 'app' || eventName == 'singletons') {
              _.each(callback, function (callback, event) {
                if (typeof callback == 'object') {
                  var obj = App[event] || App.singletons.get(event);
                  _.each(callback, function (callback, event) {
                    this.listenTo(obj, event, this.__getEventCallback__(callback));
                  }.bind(this));
                }
                else
                  this.listenTo(App, event, this.__getEventCallback__(callback));
              }.bind(this));
            }
            else if (typeof callback === 'object') {
              var isParent;
              var lastEventName = eventName;
              var recurse = function (object, context, eventName) {
                // if (eventName == 'parent')
                  // isParent = true;

                _.each(object, function (callback, event) {
                  // FIXME: super hacky workaround for views being initialized
                  // before parent inputed
                  // real fix: subView(name, View, args...)
                  if (_.contains([eventName, event, lastEventName], 'parent')) {
                    // this.bindParentEvents(event, callback);
                    return;
                  }
                  else if (typeof callback != 'object') {
                    // FIXME: this currently allows { parent: { sync: { } } }
                    if (!context)
                      console.warn('Error data', {
                        event: event,
                        context: context,
                        eventName: eventName,
                        callback: callback
                      });

                    // FIXME: refactor this shit ball
                    var obj = !context ? null
                      : context[eventName] && eventName !== 'events'
                      ? context[eventName]
                      // : context.get && context.get(eventName)
                      // ? context.get(eventName)
                      : context.getView
                      ? context.getView(eventName) || App[Utils.unCapitalize(eventName)]
                      : App[Utils.unCapitalize(eventName)];

                    if (!obj) {
                      console.warn('Error, cannot bind events, object doesn\'t exist', {
                        event: event,
                        context: context,
                        eventName: eventName,
                        callback: callback
                      });

                      throw new Error('Cannot bind events, object doesn\'t exist');
                    }

                    this.listenTo(obj, event, this.__getEventCallback__(callback));
                  }
                  else {
                    lastEventName = eventName;
                    recurse(callback, /* context.get && context.get(event) || */ context[event], event);
                  }
                }.bind(this));
              }.bind(this);
              recurse(callback, this, eventName);
            }
            else
              this.on(eventName, this.__getEventCallback__(callback));
          }.bind(this));
        },

        // Allows execute('name', arg1, arg2)
        // or execute({ name: [ arg1, arg2 ], name2: [ arg1, arg2 ] });
        execute: function (/* name, args... */) {
          var args = [].slice.call(arguments);
          var name = args.shift();
          if (typeof arguments[0] == 'string')
            return this.handlers[name].apply(this, args);
          else
            _.each(arguments[0], function (args, name) {
              this.handlers[name].apply(this, args);
            }.bind(this));
        },

        // request: function (/* name, args... */) {
        //   var args = [].slice.call(arguments);
        //   var name = args.shift();
        //   this.handlers[name].apply(this, args);
        // },

        bindParentHandlers: function () {
          if (this.handlers)
            this._recurseHandlers(this.handlers.parent, this.parent);
        },

        /**
         * Create handlers of the form:
         *
         * handlers: {
         *   parent: {
         *     paginate: 'paginate'
         *   }
         * }
         */
        _recurseHandlers: function (obj, context) {

          var recurse = function (obj, context) {
            _.each(obj, function (value, key) {
              // These need to be initialied after the parent is attached
              // to the view by the subView method
              if (key == 'parent')
                return;
              else if (typeof value == 'object')
                this._recurseHandlers(value, key == 'app' ? App : context[key]);
              else
                context.setHandler(key, this.__getEventCallback__(value), this);
            }.bind(this));
          }.bind(this);

          _.each(obj, function (value, key) {
            // These need to be initialied after the parent is attached
            // to the view by the subView method
            if (key == 'parent' && !this.parent)
              return;
            else if (typeof value == 'object')
              recurse(value, key == 'app' ? App : context[key]);
            else
              context.setHandler(key, this.__getEventCallback__(value), this);
          }.bind(this));
        },

        bindProperty: function (propertyName, string) {
          var split = string.split(':')
            , property = split.pop()
            , context = this;

          split.forEach(function (item) {
            var get, view;
            if (item.indexOf('@') === 0) {
              item = item.substring(1);
              get = true;
            }
            // else if (item.indexOf('*' === 0)) {
            //   item = item.substring(1);
            //   view = true;
            // }

            if (view)
              context = context.child(item);
            else if (get)
              context = context.get(item);
            else
              context = context[item]
                || context.child && context.child(item)
                || context.get && context.get(item);

          }.bind(this));

          var val = context.get(property);
          this.set(propertyName, val);

          this.listenTo(context, 'change:' + property, function (model, value) {
            this.set(propertyName, value);
          });

          // TODO: should this update the parent if it changes? or purely just
          // listen? or have it optionally set either way?
          // this.on('change:' + propertyName, function () {
          //   if (!noUpdate) {

          //   }
          // });
        },

        /**
         * For computed properties configuration
         *
         * computedProperties: {
         *   // Format 1
         *   baz: [ 'foo', 'bar', function (foo, bar) {
         *     return foo + bar;
         *   }],
         *   // Format 2
         *   foobar: {
         *     triggers: ['foo', 'bar'],
         *     fn: function (foo, bar) {
         *       return foo + bar
         *     }
         *   }
         * },
         */
        bindComputedProperties: function () {
          _.each(this.compute || this.computedProperties || this.bindProperties, function (config, propertyName) {
            switch (Utils.getType(config)) {
              case 'array':
                var _config = _.clone(config);
                _config.unshift(propertyName);
                this.computeProperty.apply(this, _config);
                break;
              case 'object':
                this.computeProperty(propertyName, _.clone(config));
                break;
              case 'string':
                this.bindProperty(propertyName, config);
                break;
            }
          }.bind(this));
        }
      },
      extenderClone,
      {
        initialize: function (options) {
          var re = initialize ? initialize.apply(this, arguments) : null;
          this.bindAppEvents();
          this.bindComputedProperties();

          if (options && options.handlers)
            $.extend(true, this.handlers, options.handlers);

          this._recurseHandlers(this.handlers, this);

          if (this.afterInitialize)
            this.afterInitialize.apply(this, arguments);

          return re;
        },

        _whatAmI: _.once(function () {
          if (this instanceof Backbone.Collection)
            return 'collection';
          else if (this instanceof Backbone.View)
            return 'view';
          else if (this instanceof Backbone.AssociatedModel)
            return 'associatedModel';
          else if (this instanceof Backbone.Model)
            return 'model';
        }),

        _myOriginalProto: _.once(function () {
          switch (this._whatAmI()) {
            case 'collection':
              return Backbone.Collection.prototype;
            case 'view':
              return Backbone.View.prototype;
            case 'associatedModel':
              return Backbone.AssociatedModel.prototype;
            case 'model':
              return Backbone.Model.prototype;
          }
        }),

        __get__: function (string) {
          switch (this._whatAmI()) {
            case 'collection':
              return Backbone.Collection.prototype.get.apply(this, arguments);
            case 'view':
              return this.state.get.apply(this.state, arguments);
            case 'associatedModel':
              return Backbone.AssociatedModel.prototype.get.apply(this, arguments);
            case 'model':
              return Backbone.Model.prototype.get.apply(this, arguments);
          }
        },

        get: function (string) {
          // FIXME: falsey values '', null, false, 0 will return undefined sometimes
          var get = this.__get__(string);

          return get !== undefined && get
            || typeof string == 'string' && this._parseObjectGetter(string).value;
        },

        __set__: function () {
          switch (this._whatAmI()) {
            case 'collection':
              return Backbone.Collection.prototype.set.apply(this, arguments);
            case 'view':
              return this.state.set.apply(this.state, arguments);
            case 'associatedModel':
              return Backbone.AssociatedModel.prototype.set.apply(this, arguments);
            case 'model':
              return Backbone.Model.prototype.set.apply(this, arguments);
          }
        },

        set: function (/* items, options */) {
          // FIXME: allow this.set('[0].foo.bar.baz', baz);
          if (this instanceof Backbone.Collection)
            return this.__set__.apply(this, arguments);
          else {
            var items, options;
            if (typeof arguments[0] == 'string') {
              items = {};
              items[arguments[0]] = arguments[1];
              options = arguments[2];
            }
            else {
              items = arguments[0];
              options = arguments[1];
            }

            _.each(items, function (val, path) {
              var parsed = this._parseObjectGetter(path);

              var current = parsed.moduleContext.get(parsed.modulePropNameString);

              var split = parsed.propNameString.split(/\.|\[|\]/).slice(1)
                , len = split.length
                , context
                , newVal = val;

              // QUESTION: should objets be auto created?
              if (len) {
                newVal = parsed.moduleContext.get(parsed.modulePropNameString) || {};
                context = newVal;

                _.each(split, function (item, index) {
                  if (index === len - 1)
                    context[item] = val;
                  else {
                    context[item] = context[item] || {};
                    context = context[item];
                  }
                });
              }

              parsed.moduleContext.__set__(parsed.modulePropNameString, newVal, options);
            }.bind(this));
          }
        },

        __on__: function () {
          return Backbone.Events.on.apply(this, arguments);
        },

        on: function (/* items, options */) {
          var items, context;
          var args = [].slice.call(arguments);
          if (typeof args[0] == 'string') {
            items = {};
            items[args[0]] = args[1];
            context = args[2];
          }
          else {
            items = args[0];
            context = args[1];
          }

          _.each(items, function (value, key) {
            if (key.indexOf('change:') !== 0 || this.__noBind__) {
              Backbone.Events.on.apply(this, args);
              return;
            }

            var changePath = key.replace('change:', '')
              , parsed = this._parseObjectGetter(changePath)
              , ctx = parsed.moduleContext
              , propString = parsed.modulePropNameString;

            // Prevent backbone internally calling this.on() from calling
            // infinite loop - instead set a flag and then remove
            // after backbone does its binding for listenTo
            this.__noBind__ = true;
            this.listenTo(ctx, 'change:' + propString, value);
            this.__noBind__ = false;
          }.bind(this));

          return this;
        }
        // ,

        // __listenTo__: function () {
        //   this._myOriginalProto().on.apply(this, arguments);
        // },

        // listenTo: function () {
        //   var args = _.slice(arguments);
        //   args.shift();
        //   return this.on.apply(this, args);
        // }
      });

      return obj;
    },

    app: function (obj) {
      // var initialize = obj.initialize;
      // if (initialize)
      //   delete obj.initialize;

      var rawApp = _.extend({}, obj, {
        moduleType: 'app',

        el: document.documentElement,

        singletons: new Collection(),
        Views: new Collection(null, { type: 'views' }),
        routers: new Collection(),
        models: new Collection(),

        router: new (Module.controller())(),

        initialize: function (options) {
          // if (options && options.handlers)
          //   _.extend(this.handlers, options.handlers);

          if (obj.initialize)
            return obj.initialize.apply(this, arguments);
        }
      });

      var ViewApp = Module.view(rawApp);
      var app = new ViewApp();

      // app.initialize = app.initialize.bind(require.async('app'));

      // if (_.isFunction(initialize)) {
      // if (app.autoInit)
      //   app.initialize.call(require.async('app'));
      // else if (app.initOnReady)
      //   $(app.initialize.bind(require.async('app')));
      // }

      // Maybe return new Module.View(app);
      return app;
    },

    model: function (obj, classMethods) {
      var modelType = obj.relations ? 'AssociatedModel' : 'Model';
      // var modelType = 'AssociatedModel';

      if (obj.relations)
        obj = mapRelations(obj);

      var Model = Backbone[modelType];
      var proto = Model.prototype;

      return this.module(Model.extend(_.extend({}, obj, {
        moduleType: 'model',
        initialize: function (data, options, stateData) {
          // if (this.name && this.name.toLowerCase() !== 'state') {
          //   var ThisStateModel = StateModel.extend({ defaults: obj.stateDefaults });
          //   this.state = new ThisStateModel(data, { parent: this, noBubble: true });
          // }

          if (obj.initialize)
            return obj.initialize.apply(this, arguments);
        },

        toJSON: function (recursive, useState) {
          // Settings this as the default
          if (recursive === undefined)
            recursive = true;

          function recurse (object) {
            var json = object.toJSON ? object.toJSON() : null;

            _.each(json, function (value, key) {
              var isModelOrCollection = value instanceof Backbone.AssociatedModel
                || value instanceof Backbone.Model
                || value instanceof Backbone.Collection;

              if (isModelOrCollection) {
                json[key] = value.toJSON();
                recurse(json[key]);
              }
            });

            return json;
          }

          if (useState)
            return this.state.toJSON.apply(this.state, arguments);
          else {
            var out = proto.toJSON.apply(this, arguments);
            if (recursive)
              recurse(out);
            return out;
          }
        }
        // Options here
      })), _.extend({
        moduleType: 'model',
        name: obj.name
      }, classMethods));
    },

    collection: function (obj, classMethods) {
      var proto = Backbone.Collection.prototype;
      var collection = this.module(Backbone.Collection.extend(_.extend({}, obj, {
        moduleType: 'collection',

        initialize: function (models, options, data) {
          var ThisStateModel = StateModel.extend({ defaults: obj.defaults });
          this.state = new ThisStateModel(data, { parent: this });

          this.on('add remove reset', function () {
            this.trigger('change:length');
          }, this);

          if (obj.initialize)
            return obj.initialize.apply(this, arguments);
        },

        add: function (model, options) {
          if (!_.isArray(model))
            model = [model];
          proto.add.call(this, model, options);
        },

        // set: function (models, options) {
        //   if (_.isArray(models))
        //     return proto.set.apply(this, arguments);
        //   else
        //     return this.state.set.apply(this.state, arguments);
        // },

        get: function () {
          return proto.get.apply(this, arguments) || this.state.get.apply(this.state, arguments);
        },

        toJSON: function (recursive, useState) {
          // Settings this as the default
          if (recursive === undefined)
            recursive = true;

          function recurse (object) {
            var json = object.toJSON ? object.toJSON() : null;
            _.each(json, function (value, key) {
              var isModelOrCollection = value instanceof Backbone.AssociatedModel
                || value instanceof Backbone.Model
                || value instanceof Backbone.Collection;

              if (isModelOrCollection) {
                json[key] = value.toJSON();
                recurse(json[key]);
              }
            });
          }

          if (useState)
            return this.state.toJSON.apply(this.state, arguments);
          else {
            var out = proto.toJSON.apply(this, arguments);
            if (recursive)
              recurse(out);
            return out;
          }
        }
        // Options here
      })), _.extend({
        moduleType: 'collection',
        name: obj.name
      }, classMethods));

      // Inherit Backbone.Model methods
      [
        'clear', 'isValid', '_validate', 'changedAttributes', 'previousAttributes', 'has'
      ]
      .forEach(function (method) {
        if (!collection[method])
          collection[method] = function () {
            return this.state[method].apply(this.state, arguments);
          };
      });

      return collection;
    },

    object: function () {
      return this.controller.apply(this, arguments);
    },

    controller: function (obj, staticObj, originalModifier) {
      obj = obj || {};

      // Allos 'initialize' or 'constructor' properties to be used as
      // object constructor
      var Controller = obj.initialize ||
        ( obj.constructor !== Object.prototype.constructor
          ? obj.constructor
          : function () {}
        );

      Controller.prototype = _.extend(obj, {

      });
      obj.moduleType = 'controller';

      _.extend(Controller, {
        moduleType: 'controller',
        name: obj.name
      }, staticObj);

      Controller.extend = Backbone.Model.extend;
      return this.module(Controller);
    },

    view: function (obj, classMethods) {
      var name = Utils.unCapitalize(obj.name || '');
      var hyphenName = Utils.camelToHyphens(obj.name);

      if (!obj.moduleType)
        obj.moduleType = 'view';

      var ThisStateModel = StateModel.extend({
        defaults: obj.defaults,
        relations: mapRelations(obj).relations
      });

      function updateElementAttributes () {
        var attrs = {};

        _.each(this.toJSON(), function (value, key) {
          if (typeof value == 'string' || typeof value == 'boolean')
            attrs['data-' + Utils.camelToHyphens(key)] = value;
        });

        var mappedAttrs = (this.templateAttributes || []).map(function (item) {
          return 'data-' + Utils.camelToHyphens(item);
        });

        var pickArgs = [attrs].concat(mappedAttrs);

        _.each(attrs, function (value, key) {
          var use = typeof value == 'boolean'
            || typeof value == 'number'
            || typeof value == 'string'
            && value.length < 50;

          if (use)
            pickArgs.push(key);
        });
        this.attr(_.pick.apply(_, pickArgs));

        // this.attr(attrs);
      }

      var view = _.extend({}, obj, {
        initialize: function (options) {
          options = options || {};
          this.views = this.views || {};

          if (options.parent)
            this.parent = options.parent;

          // this.attributes = this.attributes || {};
          this.state = new ThisStateModel(options, { parent: this });

          updateElementAttributes.call(this);
          this.state.on('change', updateElementAttributes.bind(this));

          // Bubble events to parent views
          this.on('all', function () {
            // FIXME: use this in other areas as well
            var options = {
              preventDefault: function () {
                this.defaultPrevented = true;
                return this;
              },

              stopPropagation: function () {
                this.bubble = false;
                return this;
              },

              stopBroadcast: function () {
                this.broadcast = false;
                return this;
              },

              target: this,
              originalTarget: this,
              currentTarget: this,
              broadcast: true,
              defaultPrevented: false,
              bubble: true
            };

            var args = [].slice.call(arguments);
            // Don't re-emit broadcast events
            if (args[0].indexOf('broadcast:') === 0) {
              _.each(this.views, function (view, key) {
                view.trigger.apply(view, args);
              });
              return;
            }

            var broadcast = (_.last(args) || {}).broadcptast !== false;
            if (args[0].indexOf('child:') !== 0 && args[0].indexOf('request:') !== 0 && broadcast)
              _.each(this.views, function (child, key) {
                var _args = _.clone(args);
                _args[0] = 'broadcast:' + _args[0];
                _args.push(_.clone(options).stopBroadcast());
                child.trigger.apply(child, _args);
              });

            var bubble = false;
            // FIXME: options should only be last arg
            // instead use (args[arg.length - 1] || {}).bubble
            args.forEach(function (arg) {
              if (arg && arg.bubble)
                bubble = true;
            });

            if (bubble && this.parent)
              this.parent.trigger.apply(this.parent, arguments);
            else if (this.parent && this.name) {
              args[0] = Utils.unCapitalize(this.name || '') + ':' + args[0];
              args.push({ bubble: true, view: this, stopBroadcast: true });
              // Trigger without nesting, e.g. photoGridPhoto:event
              this.parent.trigger.apply(this.parent, args);

              // FIXME: push view / options to end of args list?
              var args2 = [].slice.call(arguments);
              args2[0] = 'child:' + args2[0];
              // FIXME: this will break using splats for events
              // e.g. trigger('stuffWasAdded', stuff1, stuff2, etc...) since
              // we're adding args
              // POSSIBLY add options to event string?
              args2.push({ bubble: true, view: this });
              this.parent.trigger.apply(this, args2);
            }

            // var args = [].slice.call(arguments);
            // if (this.parent) {
            //   this.parent.trigger.apply(this.parent, args);
              // var newArgs = args.slice();
              // newArgs[0] = 'child:' + args[0];
              // // Bind specifically to child
              // this.parent.trigger.apply(this.parent, newArgs);
            // }
          });

          if (this.defaults)
            this.set(this.defaults, { silent: true });

          if (options && options.data)
            this.set(data, { silent: true });

          var _return;
          if (obj.initialize)
            _return = obj.initialize.apply(this, arguments);

          // if (App && App.viewList)
          //   App.viewList.add(this);

          [].concat(this.getModels(), this.getCollections()).forEach(function (item) {
            if (!item)
              return;

            var key;
             _.find(_.extend({}, this, this.attributes, this.state && this.state.attributes), function (value, _key) {
              if (value === item) {
                key = _key;
                return true;
              }
            });

            this.listenTo(item, 'all', function () {
              var bubble = false;
              var args = [].slice.call(arguments);
              args.forEach(function (arg) {
                if (arg && arg.bubble)
                  bubble = true;
              });

              if (bubble)
                this.trigger.apply(this, arguments);

              args[0] = key + ':' + args[0];
              this.trigger.apply(this, args);
            });
          }.bind(this));

          return _return;
        },

        bindParentEvents: function () {
          var events = (this.appEvents || {}).parent || {};

          _.each(events, function (callback, event) {
            if (typeof callback != 'object')
              this.listenTo(this.parent, event, this.__getEventCallback__(callback));
            else
              _.each(callback, function (callback, eventSuffix) {
                this.listenTo(this.parent, event + ':' + eventSuffix, this.__getEventCallback__(callback));
              }.bind(this));
          }.bind(this));
        },

        // Send event to all children
        // e.g. this.broadcast('hello')
        // child -> this.on('broadcast:hello', -> )
        // TODO: add an event to broadcast and bubble
        broadcast: function () {
          var args = [].slice.call(arguments);
          var name = args.shift();

          _.each(this.views, function (view) {
            view.trigger.apply(view, 'broadcast:' + name, args);
          });
        },

        // Broadcast and trigger
        vent: function () {
          this.broadcast.apply(this, arguments);
          this.trigger.apply(this, arguments);
        },

        request: function () {
          var args = [].slice.call(arguments);
          var eventName = args[0] = 'request:' + args[0];
          this.trigger.apply(this, args);

          var beforeArgs = _.clone(args);
          beforeArgs[0] = 'before:request:' + arguments[0];
          this.parent.trigger.apply(this.parent, beforeArgs);

          var parent = this;
          var response;
          var event;
          while (parent = parent.parent) {
            event = _.last(parent._events[eventName]);
            if (event) {
              response = event.callback.apply(event.ctx, args.slice(1));
              break;
            }
          }

          var afterArgs = _.clone(args);
          afterArgs[0] = 'after:request:' + arguments[0];
          this.parent.trigger.apply(this.parent, afterArgs);

          return response;
        },

        call: function (/* method, args... */) {
          var args = [].slice.call(arguments);
          var method = args.shift();
          _.each(this.views, function (view) {
            view.method.apply(view, args);
          });
        },

        apply: function (name, args) {
          return this.call.apply(this, [name, args]);
        },

        add: function () {
          return this.subView.apply(this, arguments);
        },

        clearSpinner: function (unblock) {
          UI.nextUpdate(function () {
            this.$spinner.removeClass('show');

            if (unblock)
              $(document.getElementById('main')).removeClass('backup');
          }, this);
        },

        showSpinner: function (block) {
         UI.nextUpdate(function () {
           this.$spinner.addClass('show');

            if (block)
              $(document.getElementById('main')).addClass('backup');
          }, this);
        },

        beforeRender: function ($template) {
          if (!this.hasRendered())
            this._hasRendered = true;

          if (this.viewType != 'collectionItem')
            this._initSpinner($template);

          var fadeClass = typeof this.fadeInImages == 'string'
            ? this.fadeInImages : 'fade';

          var lazyLoadDelay = typeof this.lazyLoadImages == 'number'
            ? this.lazyLoadImages : 10;

          function bindRemoveFadeOnLoad ($img) {
            $img.on('load', function () {
              UI.batchUpdate(50, function () {
                $img.removeClass(fadeClass + ' lazy-load-fade');
              });
            });
          }

          // FIXME: convert this to a handler
          if (this.fadeInImages || this.lazyLoadImages)
            $template.$('img').each(function (index, img) {
              var $img = $(img);

              if (this.lazyLoadImages) {
                var src = $img.attr('src');
                $img.addClass('lazy-load lazy-load-fade');
                if (src) {
                  $img.removeAttr('src');
                  $img.attr('data-src', src);
                }

                UI.delayUpdate(lazyLoadDelay, function () {
                  if (this.fadeInImages)
                    bindRemoveFadeOnLoad($img);

                  var dataSrc = $img.attr('data-src');
                  $img.attr('src', dataSrc);
                }, this);
              }

              if (this.fadeInImages) {
                if (!$img.is('.' + fadeClass))
                  $img.addClass(fadeClass);

                bindRemoveFadeOnLoad($img);
              }
            }.bind(this));

          if (obj.beforeRender)
            return obj.beforeRender.apply(this, arguments);
        },

        _initSpinner: function ($template) {
          // TODO: add this as part of the template fetching process
          this.$spinner = $(
            '<div data-view-spinner-container="' + hyphenName + '">' +
              '<div data-spinner>' +
                // '<div class="logo-outline sprite-loader-outline"></div>' +
                '<img class="logo-outline" src="' + config.staticRoot + '/images/loader-outline.png">' +
                '<div class="logo-body sprite-loader-logo"></div>' +
              '</div>' +
            '</div>');

          $template.append(this.$spinner);
        },

        // Turns our template from <img src="{foo}"> to <img data-bind="src:foo">
        compileTemplate: function (template, templateName, context, altContext) {
          var i = 0;
          var boundTagName = Module.template.config.boundTagName;
          template = template || '';

          // FIXME: was this commented out accidentally?
          // templateName = templateName || _.uniqueId('tmpl');

          // FIXME: don't recopile templates but modules can have multiple
          // temapltes
          var cachedCompiledTemplate = this.constructor._cachedCompiledTemplate;
          if (false /* cachedCompiledTemplate */) {
            template = cachedCompiledTemplate;
          }
          else {
            var previousMatchLength
              , lastMatch
              , index
              , subTemplate
              , newSubTemplate
              , blockMatches = template.match(/\{#/gi);

            // Block tags, e.g. {#if}, {#each} - - - - - - - - - - - - - - - - - -
            //
            // FIXME: doesn't support in attribute - e.g. <a class="{#if this}that{/}"></a>
            while (blockMatches && blockMatches.length) {
              if (previousMatchLength === blockMatches.length)
                break;
              previousMatchLength = blockMatches.length;

              lastMatch = _.last(blockMatches);
              index = template.lastIndexOf(lastMatch);
              subTemplate = template.substring(index);

              newSubTemplate = subTemplate.replace(/\{\s*#.+?\}(.|\s)*?[^\{]\{\/.*\}/gi, function (match) {
                var tag = match.match(/\{#.+?\}/gi)[0]
                  , args = tag.replace(/\{|\}/g, '').split(' ')
                  , condition = args.slice(1).join(' ')
                  , tagName = args[0].replace('#', '')
                  , body = match.replace(tag, '').replace(/\{\/.*\}/gi, '');

                if (Module.template.helpers[tagName])
                  return Module.template.helpers[tagName]({
                    body: body,
                    ctx: this,
                    altContext: altContext,
                    context: context || this,
                    condition: condition,
                    tagName: tagName,
                    args: args
                  });

                return match;
              }.bind(this));

              template = template.replace(subTemplate, newSubTemplate);
              blockMatches = template.match(/\{#/g);
            }

            // Replacements for everything non-block - - - - -
            template = template

              // Tags in attributes  - - - - - - - - - - - - - - - - - - - - - - -
              //  e.g. class="foo {bar:baz}" style="background:url({foo})"

              // Comments
              .replace(/\{!.*?\}/g, '')


              // Tags in HTML tags   - - - - - - - - - - - - - - - - - - - - - - -
              // e.g. <div {foo:bar}></div>

              .replace(/<[^<>]*?\{.+?\}[^<]*?>/gi, function (match) {
                var bindings = [];
                var originalMatch = match;

                // FIXME: allow multiple and text before and after
                match = match.replace(/[a-z\-_]*\s*=\s*"[^"]*?\{.+?\}.*?"/gi, function (match) {
                  var split = match.replace(/"|\{|\}/gi, '').split('=')
                    , attr = split.shift()
                    , binding = split.join('=')
                    , rawMatches = match.match(/\{.+?\}/gi)
                    , matchRemoved = match.replace(/\{.*?\}/gi, '');

                  // bindings.push(attr + ':' + binding);

                  var cleanMatches = rawMatches.map(function (match) {
                    return match.replace(/\{|\}/g, '');
                  });

                  var attributeBinding = Module.template.attributeBindings[attr];
                  if (attributeBinding) {
                    bindings.push(attributeBinding({
                      fullText: match,
                      attrValue: binding,
                      matches: cleanMatches,
                      rawMatches: rawMatches
                      // FIXME: maybe add matches
                    }));
                  }
                  else
                    _.each(cleanMatches, function (match) {
                      bindings.push('attr:' + attr + ' ' + match);
                    });

                  return matchRemoved;
                });

                var tags = match.match(/\{.+?\}/g)
                  , htmlTagName = ((match.match(/<[a-z\-_]+/i) || '')[0] || '').replace('<', '')
                  , restr = match;

                _.each(tags, function (tag) {
                  var tagStripped = tag.replace(/\{|\}/g, '')
                    , split = _.compact(tagStripped.split(/\s+/))
                    , replacement;

                  var options = {
                    tagName: split[0],
                    context: context || this,
                    altContext: altContext,
                    ctx: this,
                    htmlTagName: htmlTagName,
                    args: split.slice(1)
                  };

                  // FIXME: allow simple tags in html
                  //    e.g. <div {validate?validate}></div>

                  // Is a simple tag to be handled below, e.g. not
                  // {foo bar:foo} but just {foo} or {foo:bar}
                  // FIXME: convert
                  // if (!split[1])
                    // return;

                  // TODO: move this to new format with options.args
                  // rather than (args..., options)
                  var bindingHelper = Module.template.inTagBindings[split[0]];
                  if (bindingHelper) {
                    var output = bindingHelper(options);
                    bindings.push(output);
                  }
                  else
                    bindings.push(tagStripped.replace(' ', ': '));

                  restr = restr.replace(tag, '');
                }.bind(this));

                var res = restr.replace(/(<[^\/]+?)(\/?>.*?)/, '$1 data-bind="' + bindings.join(',').replace('"', '\\"') + '" $2');
                return res;
              }.bind(this))

              // Simple tags - - - - - - - - - - - - - - - - - - - - - - - - - - -
              // e.g. {foo} or {foo bar:foo}

              .replace(/\{.+?\}/gi, function (match) {
                function replace (match) {
                  // Tag interpolation
                  // if (match.match(/\{.+?\}/g).length > 1)
                  //   match = '{' + match.substring(1).replace(/\{.+?\}/g, replace);

                  var stripped = match.replace(/\{\s*|\s*\}/g, '')
                    , whiteSplit = stripped.split(' ')
                    , split = stripped.split(':')
                    , property = split[0]
                    , fn = split[1]
                    , bindText = fn ? property + ':' + fn : property
                    , args = [].concat(whiteSplit);

                  args.shift();

                  // FIXME: convert to options.args instead of (args..., options)
                  args.push({
                    // template helper options
                    context: context || this,
                    ctx: this,
                    template: template,
                    templateName: templateName,
                    altContext: altContext
                  });

                  if (whiteSplit[1] && Module.template.helpers[whiteSplit[0]]) {
                    return Module.template.helpers[whiteSplit[0]].apply(undefined, args) || '';
                  }
                  // else if (Module.template.bindings[whiteSplit[0]]) {
                  //   return ' data-bind="'
                  //     + Module.template.bindings[whiteSplit[0]].apply(undefined, args)
                  //     + '" ';
                  // }
                  else {
                    // If no split assume its text we're binding,
                    // else create new block
                    if (!whiteSplit[1])
                      bindText = 'text:' + bindText;

                    return '<' + boundTagName + ' data-bind="' + bindText.replace('"', '\\"') + '"></' + boundTagName + '>';
                  }
                }

                return replace(match);
              }.bind(this));

            // this.constructor._cachedCompiledTemplate = template;
          }

          // End template text replace - - - - - - - - - - - - - - - - - - - -

          var $template = $('<' + boundTagName + ' data-template="' + templateName + '"></' + boundTagName + '>').html(template);

          // for everything else
          $template.$('[data-bind]').each(function (index, el) {
            var $el = $(el);
            var bindingsArr = [];
            var bind = $el.attr('data-bind');

            // if ($el.is('[data-action]'))
            //   bind = _.map($el.attr('data-action').split(','), function (chunk) {
            //     return 'action:' + chunk;
            //   }).join(',');

            if (bind) {
              bindingsArr.push(bind);
              if (Module.config.templates.removeAttributes)
                $el.removeAttr('data-bind');
            }

            _.each(_.range(i), function (n) {
              var attr = $el.attr('data-bind-' + n);
              if (attr) {
                bindingsArr.push(attr);
                if (Module.config.templates.removeAttributes)
                  $el.removeAttr('data-bind-' + n);
              }
            });

            // Split by commas but ignore commas in strings
            var bindings = bindingsArr.join(',').match(/[^,']*('[^']+[^,]*'|[^,']+)[^,']*/g) || [];
            // log('*bindings*', { bindings: bindings, bindingsArr: bindingsArr });

            this.handleBindings($el, bindings, context, altContext);
          }.bind(this));

          return $template;
        },

        handleBindings: function ($el, bindings, context, altContext) {
          context = context || this;

          _.each(bindings, function (binding) {
            var helperName = binding.trim().split(' ')[0].split(':')[0].trim();
            binding = binding.replace(new RegExp(helperName + '(:?)', ''), '').trim();

            var isSimple = binding.match(/^[a-z_\-]+ [a-z_\-]/i)
              // Compact our args and also turn foo ? bar : baz into foo?bar:baz and foo = bar into foo=bar
              , contexts = []
              , hash = {}
              , hashStrings = {}
              , moduleContexts = [];

            // TODO: allow >, <
            // e.g. {#if foo.bar.length > 5} foo {/if}
            var args =
              binding.trim()
              .replace(/\s+is\s+/gi, '=')
              .replace(/\s+(gt|(is\s+)?greater than)\s*/gi, '>')
              .replace(/\s+(lt|(is\s+)?less than)\s*/gi, '<')
              .replace(/\s+(gte)\s+/gi, '>=')
              .replace(/\s+(lte)\s+/gi, '<=')
              .replace(/\s+(and|&)\s+/gi, ' && ')
              .replace(/\s+(or|\|)\s+/gi, ' || ')
              .replace(/\s+(then)\s+/gi, '?')
              .replace(/\s+(else|otherwise)\s+/gi, ':')
              .replace(/\s+(isnt|is not)\s+/gi)
              .replace(/==/g, '=')
              .replace(/\s*(\?|:|=|!=|>|<)\s*/g, '$1')
              // Split spaces ignoring quotes -
              // e.g. 'foo bar " baz "' -> ['foo', 'bar', '" baz "']
              .match(/\S*"[^"]+"|\S+/g) || [];

            _.each(args, function (arg) {
              var split = arg.split(/!?=/);
              if (typeof split[1] != 'undefined') {
                hashStrings[split[0]] = split[1];
                hash[split[0]] = this._parseObjectGetter(split[1], context, altContext).value;
              }
            }.bind(this));

            var contextObjects = []
              , argObjects = []
              , propNames = [];

            args.forEach(function (arg, index) {
              var parsed = this._parseObjectGetter(arg, context, altContext);
              argObjects.push(parsed.value);
              contextObjects.push(parsed.moduleContext);
              propNames.push(parsed.propNameString);
            }.bind(this));

            var handler = Module.template.handlers[helperName];

            argObjects.strings = args;
            hash.strings = hashStrings;

            if (handler) {
              return handler({
                args: argObjects,
                argStrings: args,
                $el: $el,
                hash: hash,
                hashStrings: hashStrings,
                context: context,
                argPropNames: propNames,
                argContexts: contextObjects,
                altContext: altContext,
                ctx: this
                // ctx: altContext && context && context.get ? context : this
              });
            }
            else {
              // throw error - no handlers given
            }

          }.bind(this));
        },

        render: function (options) {
          var o = options || {}
            , templateData = this.templateData
            , data = _.isFunction(templateData) ?
              templateData.call(this) :
              templateData || {};

          var model = this.getModel();
          var templateName = this.template || 'views/' + hyphenName;
          var modelJSON = model ? model.toJSON() : {};
          var template = Utils.getTemplate(templateName, _.extend(modelJSON, this.toJSON(), this, {
                staticRoot: config.staticRoot,
                meta: config
              }, data));

          var $template = this.compileTemplate(template, templateName);

          if (_.isFunction(this.beforeRender))
            this.beforeRender($template);

          if ( !(o.append || o.prepend) )
            this.$el.empty();

          if (o.prepend)
            this.$el.prepend($template.contents());
          else
            this.$el.append($template.contents());


          this._hasRendered = true;
          this.trigger('render');

          if (_.isFunction(this.afterRender))
            this.afterRender();

          return this;
        },

        afterRender: function () {
          if (Meta.isOldIe())
            Helpers.shimInputs(this);

          if (this.lazyLoad)
            UI.delayUpdate(this.lazyLoad !== true ? this.lazyLoad : 1, function () {
              this.$('img[data-src]').each(function (index, el) {
                var $el = $(el);
                $el.attr('src', $el.attr('data-src'));
              });
            }, this);

          if (_.isFunction(obj.afterRender))
            return obj.afterRender.apply(this, arguments);
        },

        appendTo: function (el) {
          this.$el.appendTo(el);
          return this;
        },

        children: function (asArray) {
          return this.getViews.apply(this, arguments);
        },

        child: function () {
          return this.getView.apply(this, arguments);
        },

        find: function () {
          return this.findViews.apply(this, arguments);
        },

        findOne: function () {
          return this.findView.apply(this, arguments);
        },

        getView: function () {
          var arg = arguments[0];
          return this.views[arguments[0]] || _(this.views).find(function (view) {
            return view.is(arg);
          });
        },

        // Serializes a form in a view
        // FIXME: possibly add list of elements to add
        // FIXME: possibly auto bind name="" instead to value="{value}"
        serialize: function (formEl) {
          var $el = formEl ? $(formEl) : this.$el;
          var obj = {};
          $el.$('[name]').each(function (index, el) {
            var $el = $(el);
            obj[$el.attr('name')] = $el.val();
          }.bind(this));
          return obj;
        },

        destroyViews: function (fn) {
          var views;
          if (_.isArray(fn)) {
            views = fn;
          }
          else {
            views = this.findViews(fn);
          }
          if ( !views || !views.length )
            return false;

          _.each(views, function (view) {
            view.destroy();
          }.bind(this));
        },

        setViews: function (views) {
          _.each(views, function (view, selector) {
            var $el = this.$(selector);
            if (_.isArray(view))
              _.each(view, function (view) {
                this.insertView(view);
              }.bind(this));
            else {
              this.setView(view);
            }
          }.bind(this));
        },

        setView: function (selector, view, insert) {
          if (typeof selector != 'string') {
            view = selector;
            insert = view;
          }

          this.subView(view.render()).$el.appendTo(selector ? this.$(selector) : this.$el);
        },

        destroyView: function (fn) {
          var view = this.findView(fn);
          if (view) {
            view.destroy();
            return true;
          }
          else
            return false;
        },

        parents: function (selector) {
          var results = [];
          var parent = this;
          while (parent = parent.parent)
            if (parent && ( !selector || parent.is(selector) ))
              results.push(parent);

          return results;
        },

        closest: function (selector) {
          return _.find(this.parents(), function (parent) {
            return parent.is(selector);
          });
        },

        // FIXME: need to get original height of element
        // FIXME: add customizable css class transitioning and transition timing
        // FIXME: undelegate events on hide?
        //   e.g. app events
        //   because the $el isn't going to be able to update dom, for example
        //   unless using templates directly
        // FIXME: maybe remove entier $el?
        hide: function (onlyRemoveInnards) {
          this._originalCSSDisplay = this.el.style.display;

          this._blockHide = false;
          this._viewHideDeferred = $.Deferred();
          this._isHidden = true;

          if (onlyRemoveInnards) {
            this._$innerDOM = this.$el.contents().detach();
            return $.Deferred().resolve();
          }

          this.$el.addClass('hidden');

          var transitionDuration = this.__getTransitionDuration__();
          UI.delayUpdate(transitionDuration || 0, function () {
            if (this._blockHide) {
               this._blockHide = false;
              return;
            }

            this.$el.css('display', 'none');
            this._$parent = this.$el.parent();
            this.$el.detach();
            this._viewHideDeferred.resolve();
          }, this);

          return this._viewHideDeferred;
        },

        isHidden: function () {
          return !!this._isHidden;
        },

        isVisible: function () {
          return !this._isHidden;
        },

        $: function () {
          if (this._$innerDOM)
            return this._$innerDOM.find.apply(this._$innerDOM, arguments);
          else
            return this.$el.find.apply(this.$el, arguments);
        },

        show: function () {
          this._isHidden = false;

          if (this._$innerDOM) {
            this.$el.append(this._$innerDOM);
            delete this._$innerDOM;
            return $.Deferred().resolve();
          }
          else {
            this.$el.appendTo(this._$parent);
            delete this._$parent;
          }

          this._blockHide = true;
          this.$el.css('display', this._originalCSSDisplay || '');
          this._viewShowDeffered = $.Deferred();

          UI.nextUpdate(function () {
            this.$el.removeClass('hidden');
            var transitionDuration = this.__getTransitionDuration__();

            UI.delayUpdate(transitionDuration, function () {
              this._viewShowDeffered.resolve();
            }, this);
          }, this);

          return this._viewShowDeferred;
        },

        __getTransitionDuration__: function () {
          var $el = this.$el;
          var css = $el.css('transition-duration')
            || $el.css('-webkit-transition-duration')
            || $el.css('-moz-transition-duration')
            || $el.css('-ms-transition-duration')
            || $el.css('-o-transition-duration');

          return parseFloat(css, 10) * 100 || 0;
        },

        insertView: function (selector, view, name) {
          if ( !view || typeof view == 'string' ) {
            name = view;
            view = selector;
            selector = null;
          }

          if ( !(view instanceof Backbone.View) )
            view = new view();

          var $el = typeof selector == 'string'
            ? this.$(selector)
            : selector
            ? $(selector)
            : this.$el;

          this.subView(view.render(), name).$el.appendTo($el);
          return view;
        },

        insertViews: function (views) {
          var isArray = _.isArray(views);
          _.each(views, function (view, key) {
            if (isArray)
              this.insertView(view);
            else
              this.insertView(key, view);
          }.bind(this));
        },

        getViews: function () {
          var arg = arguments[0];
          if (!arg)
            return this.views;
          return _(this.views).filter(function () {
            return view.is(arg);
          });
        },

        findView: function () {
          var args = [].slice.call(arguments);
          args.push(true);
          return this.findViews.apply(this, args);
        },

        isDetached: function () {
          return !$.contains(document.documentElement, this.el);
        },

        is: function (/* str || obj || fn */) {
          var str, obj, fn;
          var arg = arguments[0];

          if (typeof arg === 'function')
            fn = arg;
          else if (typeof arg === 'string')
            str = arg;
          else
            obj = arg;

          // Allow view.is($el)
          if (arg && arg.jquery && arg[0] === this.el)
            return true;
          // Allow view.is(el)
          else if (arg === this.el)
            return true;

          // Allows for tags: ['page']
          // so you can do parentView('page'), etc
          if ( str && _.contains(view.tags, str) )
            return true;

          if (!arg || obj === this)
            return true;

          if (str) {
            var negate = str.indexOf('!') === 0;
            var unNegatedStr = negate ? str.substring(1) : str;

            var res;
            switch (unNegatedStr) {
              case '@hidden'   : res = !this.isHidden()   ; break;
              case '@visibile' : res = !this.isVisible()  ; break;
              case '@detached' : res = !this.isDetached() ; break;
            }
            if (res)
              return negate ? !res : !!res;


            /* Match case agnostic? */
            var labelMatch = (view.label || '').toLowerCase() === str.toLowerCase();

            var elMatch = Utils['try'](function () {
              return view.$el.is(str);
            }.bind(this));

            var nameMatch = (this.name || '').toLowerCase() === str.toLowerCase();

            return !!(labelMatch || elMatch || nameMatch);
          }
          else if (fn) {
            return !!fn(this);
          }
          else {
            var match = true;

            _.each(obj, function (value, key) {
              if (!match)
                return;

              var thisKey = this.get(key) || this[key];
              // Allow for { $el: $el }
              if (value && value.jquery && thisKey && thisKey.jquery)
                match = value[0] === thisKey[0];
              else if (match && value !== thisKey)
                match = false;
            }.bind(this));

            return match;
          }
        },

        findViews: function (/* name or function */) {
          var views = []
            , arg = arguments[0]
            , findOne = arguments[1]
            , foundView
            , _break = false;

          var recurse = function (view) {
            _.each(view.views, function (childView, childViewName) {
              if (_break)
                return;

              if (childView.is(arg) || childViewName === arg) {
                views.push(childView);
                if (findOne) {
                  foundView = childView;
                  _break = true;
                }
              }

              if (childView)
                recurse(childView);
            });
          };

          recurse(this);
          return findOne ? foundView : views;
        },


        // Toggle
        // Also allows between two properties - e.g. toggle('foo', 'show', 'hide')
        toggle: function (key, onValue, offValue) {
          var current = this.get(key);
          if (onValue) {
            if (current == onValue)
              this.set(key, offValue);
            else
              this.set(key, onValue);
          }
          else {
            if (current)
              this.set(key, false);
            else
              this.set(key, true);
          }

          return this;
        },

        subView: function (view, name) {
          if (_.contains(['string', 'function'], typeof view))
            return this.getView.apply(this, arguments);

          view.parent = this;
          view.bindParentEvents();
          view.bindParentHandlers();

          if (name === true)
            this.view = view;
          else {
            var nameToUse = name || view.cid;
            if (this.views[nameToUse]) {
              console.warn('destroying view ' + nameToUse + ' because it is already defined');
              this.views[nameToUse].destroy();
            }
            this.views[nameToUse] = view;
            view.label = nameToUse;
          }

          return view;
        },

        parentView: function (selector) {
          if (!selector)
            return this.parent;

          var view = this;
          while (view = view.parent)
            if (view.is(selector))
              return view;
        },

        sibling: function () {
          return (this.siblings.apply(this, arguments) || [])[0];
        },

        siblings: function (selector) {
          if (!this.parent)
            return false;

          var matches = [];
          _(this.parent.views).each(function (view) {
            if (view.is(selector) && view !== this)
              matches.push(view);
          }.bind(this));

          return match;
        },

        className: hyphenName + ' ' + (obj.className ? obj.className : ''),

        attributes: _.extend({
          'data-view': hyphenName
        }, _.result(obj, 'attributes')),

        hasRendered: function () {
          return !!this._hasRendered;
        },

        destroySubView: function (matcher) {
          var view = this.getView(matcher);
          if (view)
            view.destroy();
          return this;
        },

        destroySubViews: function (/* string || fn */) {
          var arg = arguments[0];

          _.each(this.views, function (view, name) {
            if (view && view.destroy && view !== this)
              if ( !arguments[0] || view.is(arg) )
                view.destroy();
          }.bind(this));
          return this;
        },

        populate: function (useView) {
          var subject = useView ? this : this.getModel();
          this.$('[name]').each(function (index, el) {
            var $el = $(el);
            var name = $el.attr('name');
            $el.val(subject.get(name));
          }.bind(this));
          return this;
        },

        setModel: function (model) {
          this.model = model;
          return this;
        },

        setCollection: function (collection) {
          this.collection = collection;
          return this;
        },

        getCollections: function () {
          return _.filter(_.extend({}, this, this.attributes, this.state && this.state.attributes), function (value, key) {
            return value instanceof Backbone.Collection;
          });
        },

        getCollection: function () {
          return this.collection || _.find(_.extend({}, this, this.attributes, this.state && this.state.attributes), function (value, key) {
            return value instanceof Backbone.Collection;
          });
        },

        getModels: function () {
          var state = this.state;
          return _.filter(
            _.extend({}, this, this.attributes, this.state && this.state.attributes), function (value, key) {
            return value !== state && value instanceof Backbone.Model;
          });
        },

        getModel: function () {
          var state = this.state;
          return this.model || _.find(
            _.extend({}, this, this.attributes, this.state && this.state.attributes), function (value, key) {
            return value !== state && value instanceof Backbone.Model;
          }.bind(this));
        },

        destroy: function (animate) {
          destroy = destroy.bind(this);

          if (animate)
            this.hide().then(destroy);
          else
            destroy();

          function destroy () {
            if (this.beforeDestroy)
              this.beforeDestroy();

            if (this.cleanUp)
              this.cleanUp();

            this.undelegateEvents();
            this.$el.removeData().unbind().off();
            this.remove();
            this.off();

            ['document', 'window', 'body'].forEach(function (subject) {
              var $subject = $(
                subject == 'document' ? document
                : subject == 'window' ? window
                : subject
              );

              _.each(this[subject], function (value, key) {
                var split = key.split(' ');
                var evt = split.shift();
                var selector = split.join(' ');
                // for window: { 'click a': 'foo' }
                $subject.off(evt, selector, this[value] || value);
                // for window: { 'click touchstart touchend': 'foo' }
                $subject.off(key, this[value] || value);
              }.bind(this));
            }.bind(this));

            if (view === this)
              App.viewList.remove(this);

            if (this.cleanup)
              this.cleanup();

            this.destroySubViews();

            // _.each(this, function (value) {
            //   if (value instanceof Backbone.View && value !== this && value.destroy)
            //     value.destroy();
            // }.bind(this));

            this.trigger('destroy');

            var parentView = this.parentView();
            if (parentView)
              _.each(parentView.views, function (value, key) {
                if (value === this)
                  delete parentView.views[key];
              }.bind(this));

            if (this.afterDestroy)
              this.afterDestroy();

            this.set('destroyed', true);

            if (obj.destroy)
              return obj.destroy.apply(this, arguments);
          }
        }
      });

      if (obj.attributes)
        _.extend(view.attributes, obj.attributes);

      // Insherit jquery methods
      [
        'width', 'height', 'scrollTop', 'scrollLeft', 'append', 'prepend', 'siblings', 'hasClass',
        'appendTo', 'prependTo', 'html', 'insertBefore', 'insertAfter', 'toggle', 'wrap', 'unwrap',
        'css', 'attr', 'prop', 'addClass', 'removeClass', 'removeProp', 'removeAttr', 'toggleClass'
      ]
      .forEach(function (method) {
        if (!view[method])
          view[method] = function () {
            return this.$el[method].apply(this.$el, arguments);
          };
      });

      // Inherit Backbone.Model methods
      [
        'get', 'set', 'toJSON','clear', 'isValid', '_validate', 'changedAttributes',
        'previousAttributes', 'has'
      ]
      .forEach(function (method) {
        if (!view[method])
          view[method] = function () {
            return this.state[method].apply(this.state, arguments);
          };
      });

      return this.module(Backbone.View.extend(view, _.extend(classMethods, {
        moduleType: 'view',
        name: obj.name
      })));
    },

    router: function (obj) {
      return this.module(Backbone.Router.extend(_.extend({}, obj, {
        moduleType: 'router',
        initialize: function () {
          this.on('all', function () {
            var args = [].slice.call(arguments);
            args[0] = 'router:' + args[0];
            App.trigger.apply(App, args);
          });

          if (obj.initialize)
            return obj.initialize.apply(this, arguments);
        }
        // Options here
      })));
    },

    singleton: function (obj, stateData) {
      obj.name = obj.name || '';

      function unCapitalize(string) {
        return string[0].toLowerCase() + string.substring(1, string.length);
      }

      if (App.singletons && App.singletons[unCapitalize(obj.name)])
        return console.warn('Not creating ' + obj.name + ' because it is already defined');

      // if (App.singletons)

      var singleton = this.module(_.extend(obj, Backbone.Events, {
        moduleType: 'singleton'
        // Options here
      }));

      singleton.on('all', function () {
        // Allow listening to app
        var args = [].slice.call(arguments);
        var bubble = false;
        args[0] = unCapitalize(singleton.name || '') + ':' + args[0];
        App.trigger.apply(App, args);
      });

      var ThisStateModel = StateModel.extend({
        defaults: _.result(this, 'defaults')
      });

      // FIXME: maybe add this.stateObject
      // FIXME: add state to all objects
      singleton.state = new StateModel(stateData, { parent: singleton });

      [
        'get', 'set', 'toJSON','clear', 'isValid', '_validate', 'changedAttributes',
        'previousAttributes', 'has'
      ]
      .forEach(function (method) {
        if (!singleton[method])
          singleton[method] = function () {
            return singleton.state[method].apply(singleton.state, arguments);
          };
      });

      App[unCapitalize(obj.name)] = singleton;

      if (_.isFunction(singleton.initialize)) {
        if (singleton.autoInit)
          singleton.initialize();
        else if (singleton.initOnReady)
          $(singleton.initialize.bind(singleton));
      }

      if (App.singletons)
        App.singletons.add(singleton);
      else
        $(function () {
          App.singletons.add(singleton);
        });


      if (App.singletons)
        App.singletons[Utils.unCapitalize(obj.name)] = singleton;
      else
        $(function () {
          App.singletons[Utils.unCapitalize(obj.name)] = singleton;
        });

      return singleton;
    }
  };

  // Have a singleton collection and view etc too?
  // Maybe also allow Module.model({ singleton: true })
  Module.model.singleton = Module.singleton.model = function (options, defaults, classOptions) {
    var Model = Module.model(options, classOptions);
    var model = new Model(defaults);
    return Module.singleton(model);
  };


  // Module View Types - - - - - - - - - - - - - - - - - - - - - - - - - - - -

  _.extend(Module.view, {
    page: function (obj) {
      var name = Utils.camelToHyphens(obj.name || '');

      return Module.view(_.extend({}, obj, {
        // Set template for layoutmanager
        template: obj.template || 'views/pages/' + name + '/main',

        // Set default attributes
        attributes: _.extend({
         'data-page'  : name,
         'class': 'page'
        }, obj.attributes),

        initialize: function (options) {
          // Core bindings
          App.Router.on('route:'     + name, this.onRoute,     this);
          App.Router.on('routeAway:' + name, this.onRouteAway, this);
          Events.on('backButton:'    + name, this.backButton,  this);
          Events.on('nextButton:'    + name, this.nextButton,  this);

          this.options = options;

          if (this.defaults)
            this.set(_.extend({}, this.defaults, this.attributes), { siltent: true });

          // FIXME: it may be better to use the format
          // initialize: (options, data)
          // OR initialize: (data, options)
          // to separate attributes vs options
          // or maybe attributes should be options and functions should always be triggered
          //    more likely the case
          if (options)
            this.set(options, { silent: true });

          // FIXME: not sure if this is wise. Thorax does it, but may not
          // be necessary or good for performance / garbage collection
          // App.viewList.add(this);

          if (obj.autoRender)
            this.render();

          if (_.isFunction(obj.initialize))
            return obj.initialize.apply(this, arguments);
        },

        className: (obj.className || '') + ' page',

        onRoute: function () {
          if (obj.onRoute)
            return obj.onRoute.apply(this, arguments);
        },

        onRouteAway: function () {
          if (obj.onRouteAway)
            return obj.onRouteAway.apply(this, arguments);
        }
      }));
    }
  });

  var StateModel = Module.model({
    initialize: function (data, options) {
      var parent = this.parent = options.parent;
      this.set(data);

      this.on('all', function () {
        this.parent.trigger.apply(this.parent, arguments);
      });
    },

    // relations: {},

    name: 'state'
  });

  function mapRelations (obj) {
    if (obj.relations && !_.isArray(obj.relations)) {
      var relations = [];
      _.each(obj.relations, function (value, key) {
        var obj = {};
        var isCollection = false;
        var _super = value;

        // Check if inherited from Backbone.Collection
        while (_super = _super.__super__)
          if (_super === Backbone.Collection.prototype)
            isCollection = true;

        obj.key = key;

        if (isCollection) {
          obj.type = Backbone.Many;
          obj.collectionType = value;
          obj.relatedModel = value.prototype.model;
        }
        else {
          obj.type = Backbone.One;
          obj.relatedModel = value;
        }

        relations.push(obj);
      });

      obj.relations = relations;
    }

    return obj;
  }

  return Module.singleton(Module);
});