// Reference: Basic Username/Password Authentication blueprint integration
import { useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2, Sprout } from "lucide-react";

export default function AuthPage() {
  const { user, loginMutation, registerMutation } = useAuth();
  const [, setLocation] = useLocation();
  
  const [loginForm, setLoginForm] = useState({ username: "", password: "" });
  const [registerForm, setRegisterForm] = useState({ username: "", password: "" });

  // Redirect if already logged in
  if (user) {
    setLocation("/");
    return null;
  }

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    loginMutation.mutate(loginForm);
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    registerMutation.mutate(registerForm);
  };

  return (
    <div className="min-h-screen grid lg:grid-cols-2">
      {/* Left side - Auth Forms */}
      <div className="flex items-center justify-center py-12 px-4 sm:px-6 lg:px-8">
        <div className="w-full max-w-md space-y-8">
          <div className="text-center">
            <div className="flex justify-center">
              <Sprout className="h-12 w-12 text-green-600" />
            </div>
            <h2 className="mt-6 text-3xl font-bold tracking-tight">
              Chào mừng đến với AgriIntel
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Nền tảng dự báo giá nông sản thông minh
            </p>
          </div>

          <Tabs defaultValue="login" className="w-full">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="login" data-testid="tab-login">Đăng nhập</TabsTrigger>
              <TabsTrigger value="register" data-testid="tab-register">Đăng ký</TabsTrigger>
            </TabsList>
            
            <TabsContent value="login">
              <Card>
                <CardHeader>
                  <CardTitle>Đăng nhập</CardTitle>
                  <CardDescription>
                    Nhập thông tin tài khoản để truy cập AgriIntel
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <form onSubmit={handleLogin} className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="login-username">Tên đăng nhập</Label>
                      <Input
                        id="login-username"
                        data-testid="input-login-username"
                        type="text"
                        placeholder="Nhập tên đăng nhập"
                        value={loginForm.username}
                        onChange={(e) => setLoginForm(prev => ({ ...prev, username: e.target.value }))}
                        required
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="login-password">Mật khẩu</Label>
                      <Input
                        id="login-password"
                        data-testid="input-login-password"
                        type="password"
                        placeholder="Nhập mật khẩu"
                        value={loginForm.password}
                        onChange={(e) => setLoginForm(prev => ({ ...prev, password: e.target.value }))}
                        required
                      />
                    </div>
                    <Button 
                      type="submit" 
                      className="w-full"
                      data-testid="button-login-submit"
                      disabled={loginMutation.isPending}
                    >
                      {loginMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                      Đăng nhập
                    </Button>
                  </form>
                </CardContent>
              </Card>
            </TabsContent>
            
            <TabsContent value="register">
              <Card>
                <CardHeader>
                  <CardTitle>Đăng ký tài khoản</CardTitle>
                  <CardDescription>
                    Tạo tài khoản mới để sử dụng AgriIntel
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <form onSubmit={handleRegister} className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="register-username">Tên đăng nhập</Label>
                      <Input
                        id="register-username"
                        data-testid="input-register-username"
                        type="text"
                        placeholder="Chọn tên đăng nhập"
                        value={registerForm.username}
                        onChange={(e) => setRegisterForm(prev => ({ ...prev, username: e.target.value }))}
                        required
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="register-password">Mật khẩu</Label>
                      <Input
                        id="register-password"
                        data-testid="input-register-password"
                        type="password"
                        placeholder="Tạo mật khẩu"
                        value={registerForm.password}
                        onChange={(e) => setRegisterForm(prev => ({ ...prev, password: e.target.value }))}
                        required
                      />
                    </div>
                    <Button 
                      type="submit" 
                      className="w-full"
                      data-testid="button-register-submit"
                      disabled={registerMutation.isPending}
                    >
                      {registerMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                      Đăng ký
                    </Button>
                  </form>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>
      </div>

      {/* Right side - Hero Section */}
      <div className="hidden lg:block relative bg-gradient-to-br from-green-400 to-blue-500">
        <div className="absolute inset-0 bg-black/20" />
        <div className="relative flex items-center justify-center h-full p-8">
          <div className="text-center text-white">
            <h1 className="text-4xl font-bold mb-6">
              Dự báo giá nông sản thông minh
            </h1>
            <p className="text-lg mb-8 max-w-md">
              Sử dụng AI và máy học để dự báo giá cả nông sản Việt Nam với độ chính xác cao
            </p>
            <div className="grid grid-cols-3 gap-6 text-center">
              <div>
                <div className="text-3xl font-bold">30</div>
                <div className="text-sm opacity-90">Ngày dự báo</div>
              </div>
              <div>
                <div className="text-3xl font-bold">20+</div>
                <div className="text-sm opacity-90">Nông sản</div>
              </div>
              <div>
                <div className="text-3xl font-bold">8</div>
                <div className="text-sm opacity-90">Vùng miền</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}