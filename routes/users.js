var express = require("express");
var router = express.Router();
const mongoose = require("mongoose");
const xlsx = require('xlsx');
const crypto = require('crypto');
const bcrypt = require('bcrypt');

let { postUserValidator, validateResult } = require('../utils/validatorHandler');
let userController = require('../controllers/users');
let cartModel = require('../schemas/cart');
let userModel = require("../schemas/users");
let roleModel = require("../schemas/roles"); // Để lấy ID role 'user' tự động
let { checkLogin, checkRole } = require('../utils/authHandler.js');
let sendMailHandler = require('../utils/sendMailHandler');

// 1. Lấy danh sách User (Admin/Mod mới được xem)
router.get("/", checkLogin, checkRole("ADMIN", "MODERATOR"), async function (req, res) {
  let users = await userModel
    .find({ isDeleted: false })
    .populate({ path: 'role', select: "name" });
  res.send(users);
});

// 2. Import User từ file Excel & Gửi mail mật khẩu 16 ký tự
router.post("/import-excel", checkLogin, checkRole("ADMIN"), async function (req, res) {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    // Tìm ID của role 'USER' để gán mặc định
    const userRole = await roleModel.findOne({ name: /USER/i });
    if (!userRole) throw new Error("Không tìm thấy Role USER trong database");

    // Đọc file user.xlsx tại thư mục gốc
    const workbook = xlsx.readFile('./user.xlsx');
    const data = xlsx.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]]);

    let results = [];
    for (let item of data) {
      // Tạo mật khẩu ngẫu nhiên 16 ký tự (8 bytes hex)
      const rawPassword = crypto.randomBytes(8).toString('hex');
      const hashedPassword = bcrypt.hashSync(rawPassword, 10);

      // Tạo User mới
      let newUser = new userModel({
        username: item.username,
        email: item.email,
        password: hashedPassword,
        role: userRole._id
      });
      await newUser.save({ session });

      // Tạo giỏ hàng trống cho user mới
      await new cartModel({ user: newUser._id }).save({ session });

      // Gửi mail mật khẩu qua Mailtrap
      await sendMailHandler.sendPassMail(item.email, rawPassword);
      results.push({ email: item.email, status: "Success" });
    }

    await session.commitTransaction();
    res.send({ message: "Import thành công", details: results });
  } catch (error) {
    await session.abortTransaction();
    res.status(400).send({ error: error.message });
  } finally {
    session.endSession();
  }
});

// 3. Đổi mật khẩu (Người dùng tự thực hiện)
router.post("/change-password", checkLogin, async (req, res) => {
  try {
    const { oldPassword, newPassword } = req.body;
    const user = await userModel.findById(req.userId);

    const isMatch = bcrypt.compareSync(oldPassword, user.password);
    if (!isMatch) return res.status(400).send("Mật khẩu cũ không đúng");

    user.password = bcrypt.hashSync(newPassword, 10);
    await user.save();
    res.send("Đổi mật khẩu thành công");
  } catch (e) {
    res.status(400).send(e.message);
  }
});

// 4. Tạo User thủ công (Kèm Transaction & Cart)
router.post("/", postUserValidator, validateResult, async function (req, res) {
  let session = await mongoose.startSession();
  session.startTransaction();
  try {
    let newItem = await userController.CreateAnUser(
      req.body.username,
      req.body.password,
      req.body.email,
      req.body.role,
      session
    );
    let newCart = new cartModel({ user: newItem._id });
    let result = await newCart.save({ session });
    
    await session.commitTransaction();
    res.send(await result.populate('user'));
  } catch (err) {
    await session.abortTransaction();
    res.status(400).send({ message: err.message });
  } finally {
    session.endSession();
  }
});

// 5. Cập nhật User
router.put("/:id", async function (req, res) {
  try {
    let updatedItem = await userModel.findByIdAndUpdate(req.params.id, req.body, { new: true });
    res.send(updatedItem);
  } catch (err) {
    res.status(400).send({ message: "id not found" });
  }
});

// 6. Xóa User (Soft Delete)
router.delete("/:id", async function (req, res) {
  try {
    let updatedItem = await userModel.findByIdAndUpdate(req.params.id, { isDeleted: true }, { new: true });
    res.send(updatedItem);
  } catch (err) {
    res.status(400).send({ message: "id not found" });
  }
});

module.exports = router;