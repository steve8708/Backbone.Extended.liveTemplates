(function() {
  var Backbone, bindExpression, config, decodeAttribute, deserialize, encodeAttribute, escapeForRegex, escapeQuotes, expressionFunctionCache, getExpressionValue, getProperty, ifUnlessHelper, isExpression, isNode, liveTemplates, mapKeypath, parseExpression, replaceTemplateBlocks, requireCompatible, reservedWords, stripBoundTag, templateCache, templateHelpers, templateReplacers, traceStaticObjectGetter, unescapeQuotes, wrapExpressionGetters, zip,
    __slice = [].slice,
    __indexOf = [].indexOf || function(item) { for (var i = 0, l = this.length; i < l; i++) { if (i in this && this[i] === item) return i; } return -1; };

  requireCompatible = typeof require === 'function';

  isNode = typeof module !== 'undefined';

  Backbone = this.Backbone || requireCompatible && require('backbone');

  config = {
    dontRemoveAttributes: false,
    dontStripElements: false,
    logExpressionErrors: true,
    logCompiledTemplate: true
  };

  expressionFunctionCache = {};

  templateCache = {};

  reservedWords = 'break case catch continue debugger default delete\
  do else finally for function if in instanceof new return switch this\
  throw try typeof var void while with true false null undefined'.split(/\s+/);

  escapeQuotes = function(string) {
    return string.replace(/'/g, '&#39;');
  };

  unescapeQuotes = function(string) {
    return string.replace(/\&\#39\;/g, "'");
  };

  encodeAttribute = function(object) {
    return escapeQuotes(JSON.stringify(object));
  };

  decodeAttribute = function(string) {
    return JSON.parse(unescapeQuotes(string || ''));
  };

  isExpression = function(string) {
    return !/^[$\w_\.]+$/.test(string.trim());
  };

  escapeForRegex = function(str) {
    return str.replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, '\\$&');
  };

  deserialize = function(string) {
    var num;
    if (typeof string !== 'string') {
      return string;
    } else if (string === 'null') {
      return null;
    } else if (string === 'undefined') {
      return void 0;
    } else if (string === 'true') {
      return true;
    } else if (string === 'false') {
      return false;
    } else if (!isNaN((num = Number(string)))) {
      return num;
    } else {
      return string;
    }
  };

  zip = function() {
    var array, arrayLengths, arrays, index, item, res, _i, _j, _len, _len1, _ref;
    arrays = 1 <= arguments.length ? __slice.call(arguments, 0) : [];
    res = [];
    arrayLengths = (function() {
      var _i, _len, _results;
      _results = [];
      for (_i = 0, _len = arrays.length; _i < _len; _i++) {
        array = arrays[_i];
        _results.push(array.length);
      }
      return _results;
    })();
    _ref = new Array(Math.max.apply(Math, arrayLengths));
    for (index = _i = 0, _len = _ref.length; _i < _len; index = ++_i) {
      item = _ref[index];
      for (_j = 0, _len1 = arrays.length; _j < _len1; _j++) {
        array = arrays[_j];
        if ((item = array[index])) {
          res.push(item);
        }
      }
    }
    return res;
  };

  traceStaticObjectGetter = function(keypath, base) {
    var res, split, value;
    if (base == null) {
      base = {};
    }
    split = _.compact(keypath.split(/[\[\]\.]/));
    res = base;
    if ((function() {
      var _i, _len, _results;
      _results = [];
      for (_i = 0, _len = split.length; _i < _len; _i++) {
        value = split[_i];
        _results.push(res);
      }
      return _results;
    })()) {
      res = res[value];
    }
    return res;
  };

  liveTemplates = function(context, config, options) {
    var $template, template, _base;
    if (config == null) {
      config = {};
    }
    template = this.template || config.template || this.$el.html();
    this.liveTemplate = {
      hiddenDOM: [],
      singletons: config.singletons || {}
    };
    if ((_base = this.liveTemplate.singletons).view == null) {
      _base.view = this;
    }
    $template = liveTemplates.create(template, this);
    this.liveTemplate.$template = $template;
    return this.$el.empty().append($template);
  };

  wrapExpressionGetters = function(expression, scope) {
    var dependencies, newExpressionString, regex, splitReplace, stringSplit, strings,
      _this = this;
    regex = /[$\w][$\w\d\.]*/gi;
    dependencies = [];
    stringSplit = expression.split(/'[\s\S]*?'/);
    strings = (expression.match(/'[\s\S]*?'/g)) || [];
    splitReplace = stringSplit.map(function(string) {
      return string.replace(regex, function(keypath) {
        if (__indexOf.call(reservedWords, keypath) >= 0 || /'|"/.test(keypath)) {
          return keypath;
        }
        if (keypath.indexOf('$window.') !== 0 && keypath.indexOf('$view.') !== 0) {
          dependencies.push(mapKeypath(keypath, scope));
        }
        return "getProperty( context, '" + keypath + "', scope )";
      });
    });
    newExpressionString = zip(splitReplace, strings).join(' ');
    return [newExpressionString, dependencies];
  };

  parseExpression = function(context, expression, scope) {
    var dependencies, error, expressionIsNotSimpleGetter, fn, newExpression, _ref;
    if (isExpression(expression)) {
      expressionIsNotSimpleGetter = true;
    }
    if (expressionIsNotSimpleGetter) {
      _ref = wrapExpressionGetters(expression, scope), newExpression = _ref[0], dependencies = _ref[1];
      if (expressionFunctionCache[newExpression]) {
        fn = expressionFunctionCache[newExpression];
      } else {
        try {
          fn = new Function('context', 'getProperty', 'scope', "return ( " + newExpression + " )");
        } catch (_error) {
          error = _error;
          error.message = "\n" + "    LiveTemplate parse error:     \n" + ("        error: " + error.message + " \n") + ("        expression: " + expression);
          throw error;
        }
        expressionFunctionCache[newExpression] = fn;
      }
    }
    return {
      string: expression,
      fn: fn,
      dependencies: dependencies,
      isExpression: expressionIsNotSimpleGetter
    };
  };

  getExpressionValue = function(context, parsed, expression, scope) {
    var error, res;
    if (parsed.isExpression) {
      try {
        res = parsed.fn(context, getProperty, scope);
      } catch (_error) {
        error = _error;
        if (config.logExpressionErrors) {
          console.info("[INFO] Template error caught:      \n" + ("       Expression: " + expression + " \n") + ("       Message: " + error.message + " \n"));
        }
      }
      if (typeof res === 'string') {
        return deserialize(res);
      } else {
        return res;
      }
    } else {
      return context.get(expression.trim());
    }
  };

  bindExpression = function(context, expression, scope, callback) {
    var baseProperty, changeCallback, dep, depBase, parsed, propertyName, singleton, singletonName, split, _i, _len, _ref;
    parsed = parseExpression(context, expression, scope);
    changeCallback = function() {
      var value;
      value = getExpressionValue(context, parsed, expression, scope);
      if (callback) {
        return callback(value);
      } else {
        return value;
      }
    };
    if (parsed.dependencies) {
      _ref = parsed.dependencies;
      for (_i = 0, _len = _ref.length; _i < _len; _i++) {
        dep = _ref[_i];
        if (dep[0] === '$') {
          split = dep.split('.');
          singletonName = split.substring(1);
          singleton = context.liveTemplate.singletons[singletonName];
          propertyName = split.slice(1).join('.');
          context.listenTo(singleton, "change:" + propertyName, changeCallback);
          baseProperty = propertyName.split(/[\[\]\.]/)[0];
          context.listenTo(singleton, "change:" + baseProperty, changeCallback);
        } else if (dep.indexOf('$window.') !== 0 && dep.indexOf('$view.') !== 0) {
          context.on("change:" + dep, changeCallback);
          depBase = dep.split(/[\[\]\.]/)[0];
          context.on("change:" + depBase, changeCallback);
        }
      }
    }
    return changeCallback();
  };

  stripBoundTag = function($el) {
    var $contents, $placeholder;
    $placeholder = $(document.createTextNode('')).insertBefore($el);
    $contents = $el.contents();
    $contents.insertAfter($placeholder);
    if (!config.dontStripElements) {
      $el.remove();
    }
    return {
      $contents: $contents,
      $placeholder: $placeholder
    };
  };

  mapKeypath = function(keypath, scope) {
    var dotSplit, map, trail;
    if (scope == null) {
      scope = {};
    }
    dotSplit = keypath.split('.');
    if (scope.mappings) {
      if (dotSplit[0] in scope.mappings) {
        map = scope.mappings[dotSplit[0]];
        trail = dotSplit.slice(1).join('.');
        if (trail) {
          trail = '.' + trail;
        }
        keypath = "" + map + "[" + scope.index + "]" + trail;
      }
    }
    return keypath;
  };

  getProperty = function(context, keypath, scope) {
    var dotSplit, object, singleton, split;
    if (scope == null) {
      scope = {};
    }
    dotSplit = keypath.split('.');
    keypath = mapKeypath(keypath, scope);
    if (scope.isPlainObject) {
      split = keypath.split(/[\.\[\]]/);
      object = context.get(split[0]);
      return traceStaticObjectGetter(keypath.substring(split[0].length), object);
    } else if (keypath.indexOf('$window.') === 0) {
      return traceStaticObjectGetter(dotSplit.slice(1).join('.'), window);
    } else if (keypath.indexOf('$view.') === 0) {
      return traceStaticObjectGetter(dotSplit.slice(1).join('.'), context || this);
    } else if (keypath[0] === '$') {
      split = keypath.split('.');
      singleton = keypath[0];
      try {
        return context.liveTemplate.singletons[singleton].get(split.slice(1).join('.'));
      } catch (_error) {}
    } else {
      try {
        return context.get(keypath);
      } catch (_error) {}
    }
  };

  templateReplacers = [
    {
      regex: /\{\{![\s\S]*?\}\}/g,
      replace: function(match) {
        return '';
      }
    }, {
      regex: /<!--[\s\S]*?-->/g,
      replace: function(match) {
        return '';
      }
    }, {
      regex: /<([\w\-_]+?)[^<>]*?\{\{[\s\S]+?\}\}[^<]*?>/g,
      replace: function(context, match, tagName) {
        var attributeRe, bindings, originalMatch, replacement,
          _this = this;
        bindings = [];
        originalMatch = match;
        bindings = [];
        attributeRe = /([\w\-_]*\s*)=\s*"([^"]*?\{\{[\s\S]+?\}\}[\s\S]*?)"/g;
        replacement = match.replace(attributeRe, function(match, attrName, attrString) {
          var attrExpressionString;
          attrExpressionString = ("'" + attrString + "'").replace(/(\{\{)|(\}\})/g, function(match, isOpen, isClose) {
            if (isOpen) {
              return "' + (";
            } else if (isClose) {
              return ") + '";
            } else {
              return '';
            }
          });
          bindings.push({
            type: 'attribute',
            expression: attrExpressionString.trim(),
            attribute: attrName
          });
          return '';
        });
        replacement = replacement.replace(/(\/?>)/g, " data-bind=' " + (encodeAttribute(bindings)) + "' $1");
        return replacement;
      }
    }, {
      regex: /\{\{[\s\S]*?\}\}/g,
      replace: function(context, match) {
        var attribute;
        attribute = encodeAttribute([
          {
            type: 'text',
            expression: (match.substring(2, match.length - 2)).trim()
          }
        ]);
        return "<bound data-bind='" + attribute + "'></bound>";
      }
    }
  ];

  replaceTemplateBlocks = function(context, template) {
    var lastMatch, mustacheBlockRe, mustacheBlocks,
      _this = this;
    mustacheBlockRe = /(\{\{#[\s\S]+?\}\})([\s\S]*?)(\{\{\/[\s\S]*?\}\})/g;
    mustacheBlocks = template.match(mustacheBlockRe);
    while (mustacheBlocks && mustacheBlocks.length) {
      lastMatch = RegExp.lastMatch;
      template = template.replace(lastMatch, function() {
        var attribute, body, openTag, spaceSplit, tag;
        openTag = RegExp.$1;
        body = RegExp.$2;
        tag = openTag.substring(2, openTag.length - 2);
        spaceSplit = tag.split(" ");
        attribute = encodeAttribute([
          {
            type: spaceSplit[0].substring(1),
            expression: (spaceSplit.slice(1).join(" ")).trim()
          }
        ]);
        return "<bound data-bind='" + attribute + "'>" + body + "</bound>";
      });
      mustacheBlocks = template.match(mustacheBlockRe);
    }
    return template;
  };

  ifUnlessHelper = function(context, binding, $el, scope, inverse) {
    var $contents, $placeholder, isInserted, stripped,
      _this = this;
    stripped = stripBoundTag($el);
    $contents = stripped.$contents;
    $placeholder = stripped.$placeholder;
    isInserted = true;
    return bindExpression(context, binding.expression, scope, function(result) {
      var hiddenDOM;
      if (inverse) {
        result = !result;
      }
      if (result && !isInserted) {
        $contents.insertAfter($placeholder);
        hiddenDOM = context.liveTemplate.hiddenDOM;
        hiddenDOM.splice(hiddenDOM.indexOf($contents), 1);
        return isInserted = true;
      } else if (!result && isInserted) {
        context.liveTemplate.hiddenDOM.push($contents);
        $contents.remove();
        return isInserted = false;
      }
    });
  };

  templateHelpers = {
    each: function(context, binding, $el, scope) {
      var $placeholder, collection, currentValue, expression, inSplit, inSyntax, insertItem, items, oldValue, propertyMap, removeItem, render, reset, stripped, template, update, value,
        _this = this;
      template = $el.html();
      stripped = stripBoundTag($el);
      $placeholder = stripped.$placeholder;
      inSplit = binding.expression.split(' in ');
      inSyntax = binding.expression.split(' ')[1] === 'in';
      expression = inSyntax ? inSplit[1] : binding.expression;
      value = getProperty(context, expression);
      if (inSyntax) {
        propertyMap = inSplit[0];
      }
      collection = null;
      oldValue = null;
      currentValue = null;
      items = [];
      insertItem = function(item, index) {
        var $item, itemIsModel;
        itemIsModel = item instanceof Backbone.Model;
        scope = {
          item: item,
          mappings: {},
          index: index,
          isModel: itemIsModel,
          isPlainObject: !itemIsModel
        };
        if (inSyntax) {
          scope.mappings[propertyMap] = expression;
        }
        $item = liveTemplates.create(template, context, scope);
        items.push($item);
        return $item.insertBefore($placeholder);
      };
      removeItem = function($el) {
        $el.remove();
        return items.splice(items.indexOf($el), 1);
      };
      reset = function(value) {
        var item, _i, _len;
        currentValue = value;
        for (_i = 0, _len = items.length; _i < _len; _i++) {
          item = items[_i];
          item.remove();
        }
        items = [];
        if (value && value.forEach) {
          return value.forEach(insertItem);
        }
      };
      update = function() {
        return currentValue.forEach(function(item) {});
      };
      render = function(value) {
        reset(value);
        if (oldValue) {
          _this.stopListening(oldValue);
        }
        if (value && value.on) {
          _this.listenTo(value, 'add', insertItem);
          _this.listenTo(value, 'remove', removeItem);
          _this.listenTo(value, 'reset', function() {
            return reset(value);
          });
          _this.listenTo(value, 'add remove reset', update);
        }
        return oldValue = value;
      };
      return bindExpression(context, expression, scope, render);
    },
    attribute: function(context, binding, $el, scope) {
      var _this = this;
      return bindExpression(context, binding.expression, scope, function(result) {
        return $el.attr(binding.attribute, result || '');
      });
    },
    "if": function(context, binding, $el, scope) {
      return ifUnlessHelper.apply(null, arguments);
    },
    unless: function(context, binding, $el, scope) {
      return ifUnlessHelper.apply(null, __slice.call(arguments).concat([true]));
    },
    text: function(context, binding, $el, scope) {
      var stripped, textNode,
        _this = this;
      stripped = stripBoundTag($el);
      stripped.$contents.remove();
      textNode = stripped.$placeholder[0];
      return bindExpression(context, binding.expression, scope, function(result) {
        return textNode.textContent = result || '';
      });
    },
    outlet: function(context, binding, $el, scope) {
      var parsed, value, _base;
      parsed = parseExpression(context, binding.expression, scope);
      value = getExpressionValue(context, parsed, binding.expression, scope);
      if ((_base = this.$)[value] == null) {
        _base[value] = $();
      }
      return this.$[value].add($el);
    }
  };

  _.extend(liveTemplates, {
    create: function(template, context, scope) {
      var bound, compiled, fragment;
      compiled = this.compileTemplate(template, context);
      fragment = this.createFragment(compiled, context);
      bound = this.bindFragment(fragment, context, scope);
      return bound;
    },
    compileTemplate: function(template, context) {
      var cached, index, newTemplate, replacer, _i, _len,
        _this = this;
      if (template == null) {
        template = '';
      }
      if ((cached = templateCache[template])) {
        return cached;
      }
      newTemplate = replaceTemplateBlocks(context, template);
      for (index = _i = 0, _len = templateReplacers.length; _i < _len; index = ++_i) {
        replacer = templateReplacers[index];
        newTemplate = newTemplate.replace(replacer.regex, function() {
          var args;
          args = 1 <= arguments.length ? __slice.call(arguments, 0) : [];
          return replacer.replace.apply(replacer, [context].concat(__slice.call(args)));
        });
      }
      if (config.logCompiledTemplate) {
        console.info('[INFO] Compiled template:\n', newTemplate);
      }
      templateCache[template] = newTemplate;
      return newTemplate;
    },
    createFragment: function(template, context) {
      return $("<div>").html(template);
    },
    bindFragment: function($template, context, scope) {
      var _this = this;
      $template.find('[data-bind]').each(function(index, el) {
        var $el, binding, bindings, helper, _i, _len;
        $el = $(el);
        bindings = decodeAttribute($el.attr('data-bind'));
        for (_i = 0, _len = bindings.length; _i < _len; _i++) {
          binding = bindings[_i];
          helper = templateHelpers[binding.type];
          if (helper) {
            helper.call(context, context, binding, $el, scope);
          } else {
            throw new Error("No helper of type " + binding.type + " found");
          }
        }
        if (!config.dontRemoveAttributes) {
          return $el.removeAttr('data-bind');
        }
      });
      return $template.contents();
    }
  });

  liveTemplates.helpers = templateHelpers;

  liveTemplates.config = config;

  liveTemplates.replacers = templateReplacers;

  if (Backbone && Backbone.extensions && Backbone.extensions.view) {
    Backbone.extensions.view.liveTemplates = liveTemplates;
  }

  if (isNode) {
    module.exports = liveTemplates;
  }

  if (requireCompatible && typeof define === 'function') {
    define('live-templates', ['backbone', 'backbone.extended'](function() {
      return liveTemplates;
    }));
  }

}).call(this);
