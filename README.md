# Backbone.Extended.liveTemplates

Ultra lightweight and high performance self updating templates for Backbone! Hot dayamn

Inspired by [handlebars](http://handlebarsjs.com/), [angularjs](http://angularjs.org/), and
[ractive](http://ractivejs.org/).

```html
  <!-- DOM updates automatically as models and collections change -->
  <div id="main" role="main">
    <ul>
      {{#each person in people }}
        <li>{{ person.name }}</li>
      {{/each}}
    </ul>
    <div class="{{ showExtraInfo ? 'active' : 'hidden' }} extra-info-container">
      Hello {{ user.name ? user.name : 'Anonymous' }}!

      {{#if user.isLoggedIn() }}
        <div class="info"> Thanks for logging in!</div>

        {{#each onlineFriend in filterOnline( user.friends ) }}
          <div class="online-friend">
            <img src="{{ onlineFriend.profileImage }}" class="online-riend">
            <span class="online-friend-name">
              {{ onlineFriend.name || 'anonymous' }}
            </span>
          </div>
        {{/each}}
      {{/if}}

      {{#if user.type == 'brand' && user.subscriptionLevel == 'premium'}}
        Thank you for being a premium brand!
      {{/if}}
    </div>
  </div>
```

Documentation coming soon...
