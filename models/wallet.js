(function() {
  var MarketHelper, _, math;

  MarketHelper = require("../lib/market_helper");

  _ = require("underscore");

  math = require("../lib/math");

  module.exports = function(sequelize, DataTypes) {
    var Wallet;
    Wallet = sequelize.define("Wallet", {
      user_id: {
        type: DataTypes.INTEGER.UNSIGNED,
        allowNull: false
      },
      currency: {
        type: DataTypes.INTEGER.UNSIGNED,
        allowNull: false,
        get: function() {
          return MarketHelper.getCurrencyLiteral(this.getDataValue("currency"));
        },
        set: function(currency) {
          return this.setDataValue("currency", MarketHelper.getCurrency(currency));
        }
      },
      address: {
        type: DataTypes.STRING(34),
        allowNull: true,
        unique: true
      },
      balance: {
        type: DataTypes.BIGINT.UNSIGNED,
        defaultValue: 0,
        allowNull: false,
        comment: "FLOAT x 100000000"
      },
      hold_balance: {
        type: DataTypes.BIGINT.UNSIGNED,
        defaultValue: 0,
        allowNull: false,
        comment: "FLOAT x 100000000"
      }
    }, {
      tableName: "wallets",
      getterMethods: {
        account: function() {
          return `wallet_${this.id}`;
        },
        currency_name: function() {
          return MarketHelper.getCurrencyName(this.currency);
        },
        fee: function() {
          return MarketHelper.getTradeFee();
        },
        withdrawal_fee: function() {
          return MarketHelper.getWithdrawalFee(this.currency);
        },
        total_balance: function() {
          return parseInt(math.add(MarketHelper.toBignum(this.balance), MarketHelper.toBignum(this.hold_balance)));
        },
        network_confirmations: function() {
          return MarketHelper.getMinConfirmations(this.currency);
        }
      },
      classMethods: {
        findById: function(id, callback) {
          return Wallet.find(id).complete(callback);
        },
        findByAddress: function(address, callback) {
          return Wallet.find({
            where: {
              address: address
            }
          }).complete(callback);
        },
        findUserWalletByCurrency: function(userId, currency, callback = function() {}) {
          return Wallet.find({
            where: {
              user_id: userId,
              currency: MarketHelper.getCurrency(currency)
            }
          }).complete(callback);
        },
        findOrCreateUserWalletByCurrency: function(userId, currency, callback = function() {}) {
          return Wallet.findOrCreate({
            user_id: userId,
            currency: MarketHelper.getCurrency(currency)
          }, {
            user_id: userId,
            currency: currency
          }).complete(callback);
        },
        findUserWallets: function(userId, callback = function() {}) {
          var query;
          query = {
            where: {
              user_id: userId
            },
            order: [["created_at", "DESC"]]
          };
          return Wallet.findAll(query).complete(function(err, wallets = []) {
            wallets = _.sortBy(wallets, function(w) {
              if (w.currency === "BTC") {
                return " ";
              }
              return w.currency;
            });
            return callback(err, wallets);
          });
        },
        findUserWallet: function(userId, walletId, callback = function() {}) {
          return Wallet.find({
            where: {
              user_id: userId,
              id: walletId
            }
          }).complete(callback);
        },
        findByAccount: function(account, callback = function() {}) {
          var id;
          id = account.replace("wallet_", "");
          return Wallet.findById(id, callback);
        }
      },
      instanceMethods: {
        getFloat: function(attribute) {
          if (this[attribute] == null) {
            return this[attribute];
          }
          return MarketHelper.fromBigint(this[attribute]);
        },
        generateAddress: function(callback = function() {}) {
          return global.coreAPIClient.send("create_account", [this.account, this.currency], (err, res, body) => {
            if (err) {
              console.error(err);
              return callback(err, res, body);
            }
            if (body && body.address) {
              this.address = body.address;
              return this.save().complete(callback);
            } else {
              console.error(`Could not generate address - ${JSON.stringify(body)}`);
              return callback("Invalid address");
            }
          });
        },
        addBalance: function(newBalance, transaction, callback = function() {}) {
          if (!_.isNaN(newBalance) && _.isNumber(newBalance)) {
            return this.increment({
              balance: newBalance
            }, {
              transaction: transaction
            }).complete((err, wl) => {
              if (err) {
                return callback(`Could not add the wallet balance ${newBalance} for ${this.id}: ${err}`);
              }
              return Wallet.find(this.id, {
                transaction: transaction
              }).complete(callback);
            });
          } else {
            return callback(`Could not add wallet balance ${newBalance} for ${this.id}`);
          }
        },
        addHoldBalance: function(newBalance, transaction, callback = function() {}) {
          if (!_.isNaN(newBalance) && _.isNumber(newBalance)) {
            return this.increment({
              hold_balance: newBalance
            }, {
              transaction: transaction
            }).complete((err, wl) => {
              if (err) {
                return callback(`Could not add the wallet hold balance ${newBalance} for ${this.id}: ${err}`);
              }
              return Wallet.find(this.id, {
                transaction: transaction
              }).complete(callback);
            });
          } else {
            return callback(`Could not add wallet hold balance ${newBalance} for ${this.id}`);
          }
        },
        holdBalance: function(balance, transaction, callback = function() {}) {
          if (!_.isNaN(balance) && _.isNumber(balance) && this.canWithdraw(balance)) {
            return this.addBalance(-balance, transaction, (err) => {
              if (!err) {
                return this.addHoldBalance(balance, transaction, callback);
              } else {
                return callback(`Could not hold wallet balance ${balance} for ${this.id}, not enough funds?`);
              }
            });
          } else {
            return callback(`Could not add wallet hold balance ${balance} for ${this.id}, invalid balance ${balance}.`);
          }
        },
        canWithdraw: function(amount, includeFee = false) {
          var withdrawAmount;
          withdrawAmount = parseFloat(amount);
          if (includeFee) {
            withdrawAmount = parseFloat(math.add(MarketHelper.toBignum(withdrawAmount), MarketHelper.toBignum(this.withdrawal_fee)));
          }
          return this.balance >= withdrawAmount;
        }
      }
    });
    return Wallet;
  };

}).call(this);
