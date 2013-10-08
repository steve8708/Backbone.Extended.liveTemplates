(function() {
  var Backbone, bindExpression, config, decodeAttribute, deserialize, encodeAttribute, escapeForRegex, escapeQuotes, expressionFunctions, getExpressionValue, getProperty, ifUnlessHelper, isExpression, isNode, liveTemplates, parseExpression, replaceTemplateBlocks, requireCompatible, reservedWords, stripBoundTag, templateHelpers, templateReplacers, unescapeQuotes, wrapExpressionGetters,
    __indexOf = [].indexOf || function(item) { for (var i = 0, l = this.length; i < l; i++) { if (i in this && this[i] === item) return i; } return -1; },
    __slice = [].slice;

  requireCompatible = typeof require === 'function';

  isNode = typeof module !== 'undefined';

  Backbone = this.Backbone || requireCompatible && require('backbone');

  config = {
    dontRemoveAttributes: false,
    dontStripElements: false,
    logExpressionErrors: true,
    logCompiledTemplate: true
  };

  expressionFunctions = {};

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
    string = string.trim();
    if (string === 'null') {
      return null;
    }
    if (string === 'undefined') {
      return void 0;
    }
    if (string === 'true') {
      return true;
    }
    if (string === 'false') {
      return false;
    }
    if (!isNaN((num = Number(string)))) {
      return num;
    }
    return string;
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

  wrapExpressionGetters = function(expression) {
    var dependencies, index, item, newExpressionArray, newExpressionString, regex, splitReplace, stringSplit, strings, _i, _len, _ref,
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
          dependencies.push(keypath);
        }
        return "getProperty( context, '" + keypath + "' )";
      });
    });
    newExpressionArray = [];
    _ref = new Array(Math.max(splitReplace.length, strings.length));
    for (index = _i = 0, _len = _ref.length; _i < _len; index = ++_i) {
      item = _ref[index];
      if (splitReplace[index]) {
        newExpressionArray.push(splitReplace[index]);
      }
      if (strings[index]) {
        newExpressionArray.push(strings[index]);
      }
    }
    newExpressionString = newExpressionArray.join(' ');
    return [newExpressionString, dependencies];
  };

  parseExpression = function(context, expression) {
    var dependencies, error, expressionIsNotSimpleGetter, fn, newExpressionString, _ref;
    if (isExpression(expression)) {
      expressionIsNotSimpleGetter = true;
    }
    if (expressionIsNotSimpleGetter) {
      _ref = wrapExpressionGetters(expression), newExpressionString = _ref[0], dependencies = _ref[1];
      if (expressionFunctions[newExpressionString]) {
        fn = expressionFunctions[newExpressionString];
      } else {
        try {
          fn = new Function('context', 'getProperty', "return (" + newExpressionString + ")");
        } catch (_error) {
          error = _error;
          error.message = "\n" + "    LiveTemplate parse error:     \n" + ("        error: " + error.message + " \n") + ("        expression: " + expression);
          throw error;
        }
        expressionFunctions[newExpressionString] = fn;
      }
    }
    return {
      string: expression,
      fn: fn,
      dependencies: dependencies,
      isExpression: expressionIsNotSimpleGetter
    };
  };

  getExpressionValue = function(context, parsed, expression) {
    var error, res;
    if (parsed.isExpression) {
      try {
        res = parsed.fn(context, getProperty, expression, config);
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

  bindExpression = function(context, expression, callback) {
    var changeCallback, dep, parsed, propertyName, singleton, singletonName, split, _i, _len, _ref;
    parsed = parseExpression(context, expression);
    changeCallback = function() {
      var value;
      value = getExpressionValue(context, parsed, expression);
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
          context.listenTo(singleton, "change:" + propertyName);
        } else if (dep.indexOf('$window.') !== 0 && dep.indexOf('$view.') !== 0) {
          context.on("change:" + dep, changeCallback);
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

  getProperty = function(context, keypath, localOptions) {
    var res, singleton, split, value, _i, _j, _len, _len1, _ref, _ref1;
    if (keypath.indexOf('$window.') === 0) {
      res = window;
      _ref = keypath.split('.').slice(1);
      for (_i = 0, _len = _ref.length; _i < _len; _i++) {
        value = _ref[_i];
        if (res) {
          res = res[value];
        }
      }
      return res;
    } else if (keypath.indexOf('$view.') === 0) {
      res = this;
      _ref1 = keypath.split('.').slice(1);
      for (_j = 0, _len1 = _ref1.length; _j < _len1; _j++) {
        value = _ref1[_j];
        if (res) {
          res = res[value];
        }
      }
      return res;
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

  ifUnlessHelper = function(context, binding, $el, inverse) {
    var $contents, $placeholder, isInserted, stripped,
      _this = this;
    stripped = stripBoundTag($el);
    $contents = stripped.$contents;
    $placeholder = stripped.$placeholder;
    isInserted = true;
    return bindExpression(context, binding.expression, function(result) {
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
    each: function(context, binding, $el) {
      var $placeholder, collection, expression, inSplit, inSyntax, insertItem, items, oldValue, propertyMap, removeItem, render, reset, stripped, template, value,
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
      items = [];
      window.items = items;
      insertItem = function(model) {
        var $item;
        $item = liveTemplates.create(template, model);
        items.push($item);
        return $item.insertBefore($placeholder);
      };
      removeItem = function($el) {
        $el.remove();
        return items.splice(items.indexOf($el), 1);
      };
      reset = function(value) {
        var item, _i, _len;
        for (_i = 0, _len = items.length; _i < _len; _i++) {
          item = items[_i];
          item.remove();
        }
        items = [];
        if (value && value.forEach) {
          return value.forEach(insertItem);
        }
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
        }
        return oldValue = value;
      };
      return bindExpression(context, expression, render);
    },
    attribute: function(context, binding, $el) {
      var _this = this;
      return bindExpression(context, binding.expression, function(result) {
        return $el.attr(binding.attribute, result || '');
      });
    },
    "if": function(context, binding, $el) {
      return ifUnlessHelper.apply(null, arguments);
    },
    unless: function(context, binding, $el) {
      return ifUnlessHelper.apply(null, __slice.call(arguments).concat([true]));
    },
    text: function(context, binding, $el) {
      var stripped, textNode,
        _this = this;
      stripped = stripBoundTag($el);
      stripped.$contents.remove();
      textNode = stripped.$placeholder[0];
      return bindExpression(context, binding.expression, function(result) {
        return textNode.textContent = result || '';
      });
    },
    outlet: function(context, binding, $el) {
      var parsed, value, _base;
      parsed = parseExpression(context, binding.expression);
      value = getExpressionValue(context, parsed, binding.expression);
      if ((_base = this.$)[value] == null) {
        _base[value] = $();
      }
      return this.$[value].add($el);
    }
  };

  _.extend(liveTemplates, {
    create: function(template, context) {
      var bound, compiled, fragment;
      compiled = this.compileTemplate(template, context);
      fragment = this.createFragment(compiled, context);
      bound = this.bindFragment(fragment, context);
      return bound;
    },
    compileTemplate: function(template, context) {
      var index, replacer, _i, _len,
        _this = this;
      if (template == null) {
        template = '';
      }
      template = replaceTemplateBlocks(context, template);
      for (index = _i = 0, _len = templateReplacers.length; _i < _len; index = ++_i) {
        replacer = templateReplacers[index];
        template = template.replace(replacer.regex, function() {
          var args;
          args = 1 <= arguments.length ? __slice.call(arguments, 0) : [];
          return replacer.replace.apply(replacer, [context].concat(__slice.call(args)));
        });
      }
      if (config.logCompiledTemplate) {
        console.info('[INFO] Compiled template:\n', template);
      }
      return template;
    },
    createFragment: function(template, context) {
      return $("<div>").html(template);
    },
    bindFragment: function($template, context) {
      var _this = this;
      $template.find('[data-bind]').each(function(index, el) {
        var $el, binding, bindings, helper, _i, _len;
        $el = $(el);
        bindings = decodeAttribute($el.attr('data-bind'));
        for (_i = 0, _len = bindings.length; _i < _len; _i++) {
          binding = bindings[_i];
          helper = templateHelpers[binding.type];
          if (helper) {
            helper.call(context, context, binding, $el);
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
